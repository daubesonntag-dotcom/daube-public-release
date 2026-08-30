#include <vulkan/vulkan.h>
#include <ctype.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>

#include "daube_shader_spv.h"

#define MAX_TOTAL_PIXELS 4194240u /* 65535 workgroups * 64 lanes */
#define CHECK_VK(expr, label) do { VkResult _r = (expr); if (_r != VK_SUCCESS) { fprintf(stderr, "%s:%d\n", label, (int)_r); rc = 20; goto cleanup; } } while (0)

static int contains_ci(const char *haystack, const char *needle) {
  if (!haystack || !needle) return 0;
  const size_t n = strlen(needle);
  for (const char *p = haystack; *p; ++p) {
    size_t i = 0;
    while (i < n && p[i] && tolower((unsigned char)p[i]) == tolower((unsigned char)needle[i])) ++i;
    if (i == n) return 1;
  }
  return 0;
}

static void json_string(const char *s) {
  putchar('"');
  for (const unsigned char *p = (const unsigned char *)(s ? s : ""); *p; ++p) {
    if (*p == '"' || *p == '\\') { putchar('\\'); putchar(*p); }
    else if (*p >= 0x20 && *p < 0x7f) putchar(*p);
    else printf("\\u%04x", (unsigned)*p);
  }
  putchar('"');
}

static double now_ms(void) {
  struct timespec ts;
  if (clock_gettime(CLOCK_MONOTONIC, &ts) != 0) return 0.0;
  return (double)ts.tv_sec * 1000.0 + (double)ts.tv_nsec / 1000000.0;
}

static uint32_t find_memory_type(VkPhysicalDevice physical, uint32_t type_bits, VkMemoryPropertyFlags wanted) {
  VkPhysicalDeviceMemoryProperties props;
  vkGetPhysicalDeviceMemoryProperties(physical, &props);
  for (uint32_t i = 0; i < props.memoryTypeCount; ++i) {
    if ((type_bits & (1u << i)) && (props.memoryTypes[i].propertyFlags & wanted) == wanted) return i;
  }
  return UINT32_MAX;
}

static int file_pixels(const char *path, uint32_t *pixels_out) {
  struct stat st;
  if (stat(path, &st) != 0) return 1;
  if (st.st_size <= 0 || (st.st_size % 4) != 0) return 2;
  const uint64_t pixels = (uint64_t)st.st_size / 4u;
  if (pixels == 0 || pixels > MAX_TOTAL_PIXELS) return 3;
  *pixels_out = (uint32_t)pixels;
  return 0;
}

static int read_exact(const char *path, void *dst, size_t size) {
  FILE *f = fopen(path, "rb");
  if (!f) return 1;
  const size_t n = fread(dst, 1, size, f);
  const int close_rc = fclose(f);
  if (n != size) return 2;
  return close_rc == 0 ? 0 : 3;
}

static int write_exact(const char *path, const void *src, size_t size) {
  FILE *f = fopen(path, "wb");
  if (!f) return 1;
  const size_t n = fwrite(src, 1, size, f);
  const int close_rc = fclose(f);
  if (n != size) return 2;
  return close_rc == 0 ? 0 : 3;
}

static void *read_binary_file(const char *path, size_t *size_out) {
  *size_out = 0;
  if (!path || !*path) return NULL;
  FILE *f = fopen(path, "rb");
  if (!f) return NULL;
  if (fseek(f, 0, SEEK_END) != 0) { fclose(f); return NULL; }
  const long n = ftell(f);
  if (n <= 0 || n > 16 * 1024 * 1024) { fclose(f); return NULL; }
  rewind(f);
  void *data = malloc((size_t)n);
  if (!data) { fclose(f); return NULL; }
  if (fread(data, 1, (size_t)n, f) != (size_t)n) { free(data); fclose(f); return NULL; }
  fclose(f);
  *size_out = (size_t)n;
  return data;
}

static int save_pipeline_cache(VkDevice device, VkPipelineCache cache, const char *path) {
  if (!path || !*path || cache == VK_NULL_HANDLE) return 0;
  size_t size = 0;
  if (vkGetPipelineCacheData(device, cache, &size, NULL) != VK_SUCCESS || size == 0 || size > 16 * 1024 * 1024) return 0;
  void *data = malloc(size);
  if (!data) return 0;
  if (vkGetPipelineCacheData(device, cache, &size, data) != VK_SUCCESS) { free(data); return 0; }
  const int ok = write_exact(path, data, size) == 0;
  free(data);
  return ok;
}

int main(int argc, char **argv) {
  if (argc < 3 || ((argc - 1) % 2) != 0) {
    fprintf(stderr, "usage: daube-vulkan-rgba-maxperf INPUT1 OUTPUT1 [INPUT2 OUTPUT2 ...]\n");
    return 2;
  }

  const uint32_t job_count = (uint32_t)((argc - 1) / 2);
  uint32_t max_pixels = 0;
  uint64_t total_pixels = 0;
  for (uint32_t i = 0; i < job_count; ++i) {
    uint32_t pixels = 0;
    const int prc = file_pixels(argv[1 + (int)i * 2], &pixels);
    if (prc != 0) { fprintf(stderr, "input_invalid:%u:%d\n", i, prc); return 3; }
    if (pixels > max_pixels) max_pixels = pixels;
    total_pixels += pixels;
  }

  int rc = 1;
  VkInstance instance = VK_NULL_HANDLE;
  VkDevice device = VK_NULL_HANDLE;
  VkBuffer buffer = VK_NULL_HANDLE;
  VkDeviceMemory memory = VK_NULL_HANDLE;
  VkDescriptorSetLayout set_layout = VK_NULL_HANDLE;
  VkPipelineLayout pipeline_layout = VK_NULL_HANDLE;
  VkShaderModule shader = VK_NULL_HANDLE;
  VkPipelineCache pipeline_cache = VK_NULL_HANDLE;
  VkPipeline pipeline = VK_NULL_HANDLE;
  VkDescriptorPool descriptor_pool = VK_NULL_HANDLE;
  VkCommandPool command_pool = VK_NULL_HANDLE;
  VkCommandBuffer cmd = VK_NULL_HANDLE;
  VkFence fence = VK_NULL_HANDLE;
  void *mapped = NULL;
  VkPhysicalDevice physical = VK_NULL_HANDLE;
  VkPhysicalDeviceProperties chosen_props = {0};
  uint32_t queue_family = UINT32_MAX;
  VkQueue queue = VK_NULL_HANDLE;
  int cache_loaded = 0;
  int cache_saved = 0;
  const char *cache_path = getenv("DAUBE_VK_PIPELINE_CACHE_PATH");
  void *initial_cache = NULL;
  size_t initial_cache_size = 0;

  const double start_ms = now_ms();

  VkApplicationInfo app = {0};
  app.sType = VK_STRUCTURE_TYPE_APPLICATION_INFO;
  app.pApplicationName = "D'AUBE Phone Edge MaxPerf";
  app.applicationVersion = VK_MAKE_VERSION(1, 0, 0);
  app.pEngineName = "daube-phone-edge-gpu";
  app.engineVersion = VK_MAKE_VERSION(6, 0, 0);
  app.apiVersion = VK_API_VERSION_1_0;

  VkInstanceCreateInfo ici = {0};
  ici.sType = VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO;
  ici.pApplicationInfo = &app;
  CHECK_VK(vkCreateInstance(&ici, NULL, &instance), "vkCreateInstance");

  uint32_t device_count = 0;
  CHECK_VK(vkEnumeratePhysicalDevices(instance, &device_count, NULL), "vkEnumeratePhysicalDevices.count");
  if (!device_count) { fprintf(stderr, "no_vulkan_physical_device\n"); rc = 4; goto cleanup; }
  VkPhysicalDevice *devices = (VkPhysicalDevice *)calloc(device_count, sizeof(*devices));
  if (!devices) { rc = 5; goto cleanup; }
  VkResult enum_result = vkEnumeratePhysicalDevices(instance, &device_count, devices);
  if (enum_result != VK_SUCCESS) { fprintf(stderr, "vkEnumeratePhysicalDevices.list:%d\n", (int)enum_result); free(devices); rc = 20; goto cleanup; }

  for (uint32_t d = 0; d < device_count && physical == VK_NULL_HANDLE; ++d) {
    VkPhysicalDeviceProperties props;
    vkGetPhysicalDeviceProperties(devices[d], &props);
    if (props.deviceType == VK_PHYSICAL_DEVICE_TYPE_CPU || contains_ci(props.deviceName, "llvmpipe") || contains_ci(props.deviceName, "lavapipe") || contains_ci(props.deviceName, "swiftshader") || contains_ci(props.deviceName, "software")) continue;
    uint32_t qcount = 0;
    vkGetPhysicalDeviceQueueFamilyProperties(devices[d], &qcount, NULL);
    if (!qcount) continue;
    VkQueueFamilyProperties *qprops = (VkQueueFamilyProperties *)calloc(qcount, sizeof(*qprops));
    if (!qprops) continue;
    vkGetPhysicalDeviceQueueFamilyProperties(devices[d], &qcount, qprops);
    for (uint32_t q = 0; q < qcount; ++q) {
      if ((qprops[q].queueFlags & VK_QUEUE_COMPUTE_BIT) && qprops[q].queueCount > 0) {
        physical = devices[d];
        chosen_props = props;
        queue_family = q;
        break;
      }
    }
    free(qprops);
  }
  free(devices);
  if (physical == VK_NULL_HANDLE || queue_family == UINT32_MAX) { fprintf(stderr, "no_hardware_compute_gpu\n"); rc = 6; goto cleanup; }

  const uint32_t max_groups_x = chosen_props.limits.maxComputeWorkGroupCount[0];
  const uint32_t required_groups_x = (max_pixels + 63u) / 64u;
  if (required_groups_x == 0 || required_groups_x > max_groups_x) { fprintf(stderr, "dispatch_limit_exceeded\n"); rc = 7; goto cleanup; }

  float priority = 1.0f;
  VkDeviceQueueCreateInfo qci = {0};
  qci.sType = VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO;
  qci.queueFamilyIndex = queue_family;
  qci.queueCount = 1;
  qci.pQueuePriorities = &priority;
  VkDeviceCreateInfo dci = {0};
  dci.sType = VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO;
  dci.queueCreateInfoCount = 1;
  dci.pQueueCreateInfos = &qci;
  CHECK_VK(vkCreateDevice(physical, &dci, NULL, &device), "vkCreateDevice");
  vkGetDeviceQueue(device, queue_family, 0, &queue);

  const VkDeviceSize buffer_bytes = (VkDeviceSize)max_pixels * sizeof(uint32_t);
  VkBufferCreateInfo bci = {0};
  bci.sType = VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO;
  bci.size = buffer_bytes;
  bci.usage = VK_BUFFER_USAGE_STORAGE_BUFFER_BIT;
  bci.sharingMode = VK_SHARING_MODE_EXCLUSIVE;
  CHECK_VK(vkCreateBuffer(device, &bci, NULL, &buffer), "vkCreateBuffer");
  VkMemoryRequirements mem_req;
  vkGetBufferMemoryRequirements(device, buffer, &mem_req);
  const uint32_t mem_type = find_memory_type(physical, mem_req.memoryTypeBits, VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT);
  if (mem_type == UINT32_MAX) { fprintf(stderr, "no_host_visible_coherent_memory\n"); rc = 8; goto cleanup; }
  VkMemoryAllocateInfo mai = {0};
  mai.sType = VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO;
  mai.allocationSize = mem_req.size;
  mai.memoryTypeIndex = mem_type;
  CHECK_VK(vkAllocateMemory(device, &mai, NULL, &memory), "vkAllocateMemory");
  CHECK_VK(vkBindBufferMemory(device, buffer, memory, 0), "vkBindBufferMemory");
  CHECK_VK(vkMapMemory(device, memory, 0, buffer_bytes, 0, &mapped), "vkMapMemory");

  VkDescriptorSetLayoutBinding binding = {0};
  binding.binding = 0;
  binding.descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
  binding.descriptorCount = 1;
  binding.stageFlags = VK_SHADER_STAGE_COMPUTE_BIT;
  VkDescriptorSetLayoutCreateInfo dlci = {0};
  dlci.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
  dlci.bindingCount = 1;
  dlci.pBindings = &binding;
  CHECK_VK(vkCreateDescriptorSetLayout(device, &dlci, NULL, &set_layout), "vkCreateDescriptorSetLayout");

  VkPushConstantRange push_range = {0};
  push_range.stageFlags = VK_SHADER_STAGE_COMPUTE_BIT;
  push_range.offset = 0;
  push_range.size = sizeof(uint32_t);
  VkPipelineLayoutCreateInfo plci = {0};
  plci.sType = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO;
  plci.setLayoutCount = 1;
  plci.pSetLayouts = &set_layout;
  plci.pushConstantRangeCount = 1;
  plci.pPushConstantRanges = &push_range;
  CHECK_VK(vkCreatePipelineLayout(device, &plci, NULL, &pipeline_layout), "vkCreatePipelineLayout");

  VkShaderModuleCreateInfo smci = {0};
  smci.sType = VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO;
  smci.codeSize = daube_shader_spv_len;
  smci.pCode = daube_shader_spv;
  CHECK_VK(vkCreateShaderModule(device, &smci, NULL, &shader), "vkCreateShaderModule");

  initial_cache = read_binary_file(cache_path, &initial_cache_size);
  VkPipelineCacheCreateInfo pcci = {0};
  pcci.sType = VK_STRUCTURE_TYPE_PIPELINE_CACHE_CREATE_INFO;
  pcci.initialDataSize = initial_cache_size;
  pcci.pInitialData = initial_cache;
  VkResult cache_rc = vkCreatePipelineCache(device, &pcci, NULL, &pipeline_cache);
  if (cache_rc != VK_SUCCESS && initial_cache_size > 0) {
    pcci.initialDataSize = 0;
    pcci.pInitialData = NULL;
    cache_rc = vkCreatePipelineCache(device, &pcci, NULL, &pipeline_cache);
  } else if (cache_rc == VK_SUCCESS && initial_cache_size > 0) {
    cache_loaded = 1;
  }
  free(initial_cache);
  initial_cache = NULL;
  if (cache_rc != VK_SUCCESS) { fprintf(stderr, "vkCreatePipelineCache:%d\n", (int)cache_rc); rc = 20; goto cleanup; }

  VkPipelineShaderStageCreateInfo stage = {0};
  stage.sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
  stage.stage = VK_SHADER_STAGE_COMPUTE_BIT;
  stage.module = shader;
  stage.pName = "main";
  VkComputePipelineCreateInfo cpci = {0};
  cpci.sType = VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO;
  cpci.stage = stage;
  cpci.layout = pipeline_layout;
  CHECK_VK(vkCreateComputePipelines(device, pipeline_cache, 1, &cpci, NULL, &pipeline), "vkCreateComputePipelines");

  VkDescriptorPoolSize pool_size = {VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1};
  VkDescriptorPoolCreateInfo dpci = {0};
  dpci.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO;
  dpci.maxSets = 1;
  dpci.poolSizeCount = 1;
  dpci.pPoolSizes = &pool_size;
  CHECK_VK(vkCreateDescriptorPool(device, &dpci, NULL, &descriptor_pool), "vkCreateDescriptorPool");
  VkDescriptorSetAllocateInfo dsai = {0};
  dsai.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO;
  dsai.descriptorPool = descriptor_pool;
  dsai.descriptorSetCount = 1;
  dsai.pSetLayouts = &set_layout;
  VkDescriptorSet descriptor = VK_NULL_HANDLE;
  CHECK_VK(vkAllocateDescriptorSets(device, &dsai, &descriptor), "vkAllocateDescriptorSets");
  VkDescriptorBufferInfo dbi = {buffer, 0, buffer_bytes};
  VkWriteDescriptorSet write = {0};
  write.sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
  write.dstSet = descriptor;
  write.dstBinding = 0;
  write.descriptorCount = 1;
  write.descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
  write.pBufferInfo = &dbi;
  vkUpdateDescriptorSets(device, 1, &write, 0, NULL);

  VkCommandPoolCreateInfo pool_ci = {0};
  pool_ci.sType = VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO;
  pool_ci.flags = VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT;
  pool_ci.queueFamilyIndex = queue_family;
  CHECK_VK(vkCreateCommandPool(device, &pool_ci, NULL, &command_pool), "vkCreateCommandPool");
  VkCommandBufferAllocateInfo cbai = {0};
  cbai.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO;
  cbai.commandPool = command_pool;
  cbai.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY;
  cbai.commandBufferCount = 1;
  CHECK_VK(vkAllocateCommandBuffers(device, &cbai, &cmd), "vkAllocateCommandBuffers");
  VkFenceCreateInfo fci = {0};
  fci.sType = VK_STRUCTURE_TYPE_FENCE_CREATE_INFO;
  CHECK_VK(vkCreateFence(device, &fci, NULL, &fence), "vkCreateFence");

  for (uint32_t i = 0; i < job_count; ++i) {
    const char *input_path = argv[1 + (int)i * 2];
    const char *output_path = argv[2 + (int)i * 2];
    uint32_t pixels = 0;
    if (file_pixels(input_path, &pixels) != 0) { fprintf(stderr, "input_restat_failed:%u\n", i); rc = 9; goto cleanup; }
    const size_t bytes = (size_t)pixels * sizeof(uint32_t);
    if (read_exact(input_path, mapped, bytes) != 0) { fprintf(stderr, "input_read_failed:%u\n", i); rc = 10; goto cleanup; }

    if (i > 0) CHECK_VK(vkResetCommandBuffer(cmd, 0), "vkResetCommandBuffer");
    VkCommandBufferBeginInfo begin = {0};
    begin.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO;
    begin.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
    CHECK_VK(vkBeginCommandBuffer(cmd, &begin), "vkBeginCommandBuffer");

    VkMemoryBarrier host_to_shader = {0};
    host_to_shader.sType = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
    host_to_shader.srcAccessMask = VK_ACCESS_HOST_WRITE_BIT;
    host_to_shader.dstAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT;
    vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_HOST_BIT, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, 0, 1, &host_to_shader, 0, NULL, 0, NULL);

    vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, pipeline);
    vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, pipeline_layout, 0, 1, &descriptor, 0, NULL);
    vkCmdPushConstants(cmd, pipeline_layout, VK_SHADER_STAGE_COMPUTE_BIT, 0, sizeof(pixels), &pixels);
    vkCmdDispatch(cmd, (pixels + 63u) / 64u, 1, 1);

    VkMemoryBarrier shader_to_host = {0};
    shader_to_host.sType = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
    shader_to_host.srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
    shader_to_host.dstAccessMask = VK_ACCESS_HOST_READ_BIT;
    vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_HOST_BIT, 0, 1, &shader_to_host, 0, NULL, 0, NULL);
    CHECK_VK(vkEndCommandBuffer(cmd), "vkEndCommandBuffer");

    CHECK_VK(vkResetFences(device, 1, &fence), "vkResetFences");
    VkSubmitInfo submit = {0};
    submit.sType = VK_STRUCTURE_TYPE_SUBMIT_INFO;
    submit.commandBufferCount = 1;
    submit.pCommandBuffers = &cmd;
    CHECK_VK(vkQueueSubmit(queue, 1, &submit, fence), "vkQueueSubmit");
    CHECK_VK(vkWaitForFences(device, 1, &fence, VK_TRUE, UINT64_MAX), "vkWaitForFences");

    if (write_exact(output_path, mapped, bytes) != 0) { fprintf(stderr, "output_write_failed:%u\n", i); rc = 11; goto cleanup; }
  }

  cache_saved = save_pipeline_cache(device, pipeline_cache, cache_path);
  const double elapsed_ms = now_ms() - start_ms;
  printf("{\"schema\":\"daube.phone-edge-v6-maxperf-runtime.v1\",\"status\":\"PASS\",\"device\":");
  json_string(chosen_props.deviceName);
  printf(",\"jobs\":%u,\"dispatches\":%u,\"totalPixels\":%llu,\"maxPixels\":%u,\"bufferBytes\":%llu,\"elapsedMs\":%.3f,\"wholeImageDispatch\":true,\"queueWaitIdleUsed\":false,\"fenceSynchronization\":true,\"pipelineCacheLoaded\":%s,\"pipelineCacheSaved\":%s,\"contextCreates\":1,\"deviceCreates\":1,\"pipelineCreates\":1,\"privateAssetsUsed\":false,\"paidSpendAuthorized\":false}\n",
         job_count, job_count, (unsigned long long)total_pixels, max_pixels,
         (unsigned long long)buffer_bytes, elapsed_ms,
         cache_loaded ? "true" : "false", cache_saved ? "true" : "false");
  rc = 0;

cleanup:
  free(initial_cache);
  if (device != VK_NULL_HANDLE) {
    if (fence != VK_NULL_HANDLE) vkDestroyFence(device, fence, NULL);
    if (command_pool != VK_NULL_HANDLE) vkDestroyCommandPool(device, command_pool, NULL);
    if (descriptor_pool != VK_NULL_HANDLE) vkDestroyDescriptorPool(device, descriptor_pool, NULL);
    if (pipeline != VK_NULL_HANDLE) vkDestroyPipeline(device, pipeline, NULL);
    if (pipeline_cache != VK_NULL_HANDLE) vkDestroyPipelineCache(device, pipeline_cache, NULL);
    if (shader != VK_NULL_HANDLE) vkDestroyShaderModule(device, shader, NULL);
    if (pipeline_layout != VK_NULL_HANDLE) vkDestroyPipelineLayout(device, pipeline_layout, NULL);
    if (set_layout != VK_NULL_HANDLE) vkDestroyDescriptorSetLayout(device, set_layout, NULL);
    if (mapped) vkUnmapMemory(device, memory);
    if (buffer != VK_NULL_HANDLE) vkDestroyBuffer(device, buffer, NULL);
    if (memory != VK_NULL_HANDLE) vkFreeMemory(device, memory, NULL);
    vkDestroyDevice(device, NULL);
  }
  if (instance != VK_NULL_HANDLE) vkDestroyInstance(instance, NULL);
  return rc;
}

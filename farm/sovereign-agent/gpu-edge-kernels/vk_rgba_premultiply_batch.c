#include <vulkan/vulkan.h>
#include <ctype.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "rgba_premultiply_spv.h"

#define TILE_PIXELS 4096u
#define MAX_TOTAL_PIXELS 262144u
#define CHECK_VK(expr, label) do { VkResult _r = (expr); if (_r != VK_SUCCESS) { fprintf(stderr, "%s:%d\n", label, (int)_r); rc = 20; goto cleanup; } } while (0)

static int contains_ci(const char *haystack, const char *needle) {
  if (!haystack || !needle) return 0;
  size_t n = strlen(needle);
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

static uint32_t find_memory_type(VkPhysicalDevice physical, uint32_t type_bits, VkMemoryPropertyFlags wanted) {
  VkPhysicalDeviceMemoryProperties props;
  vkGetPhysicalDeviceMemoryProperties(physical, &props);
  for (uint32_t i = 0; i < props.memoryTypeCount; ++i) {
    if ((type_bits & (1u << i)) && (props.memoryTypes[i].propertyFlags & wanted) == wanted) return i;
  }
  return UINT32_MAX;
}

static int read_input(const char *path, uint32_t **words_out, uint32_t *count_out) {
  FILE *f = fopen(path, "rb");
  if (!f) return 1;
  if (fseek(f, 0, SEEK_END) != 0) { fclose(f); return 2; }
  long size = ftell(f);
  if (size <= 0 || size > (long)(MAX_TOTAL_PIXELS * sizeof(uint32_t)) || (size % 4) != 0) { fclose(f); return 3; }
  rewind(f);
  uint32_t *words = (uint32_t *)malloc((size_t)size);
  if (!words) { fclose(f); return 4; }
  if (fread(words, 1, (size_t)size, f) != (size_t)size) { free(words); fclose(f); return 5; }
  fclose(f);
  *words_out = words;
  *count_out = (uint32_t)((size_t)size / sizeof(uint32_t));
  return 0;
}

static int write_output(const char *path, const void *data, size_t size) {
  FILE *f = fopen(path, "wb");
  if (!f) return 1;
  int ok = fwrite(data, 1, size, f) == size ? 0 : 2;
  if (fclose(f) != 0 && ok == 0) ok = 3;
  return ok;
}

int main(int argc, char **argv) {
  if (argc != 3) {
    fprintf(stderr, "usage: daube-vulkan-rgba-premultiply-batch INPUT_RGBA8_BIN OUTPUT_RGBA8_BIN\n");
    return 2;
  }

  uint32_t *input_words = NULL;
  uint32_t total_pixels = 0;
  int input_rc = read_input(argv[1], &input_words, &total_pixels);
  if (input_rc != 0) { fprintf(stderr, "input_invalid:%d\n", input_rc); return 3; }
  uint32_t *output_words = (uint32_t *)malloc((size_t)total_pixels * sizeof(uint32_t));
  if (!output_words) { free(input_words); return 5; }

  int rc = 1;
  VkInstance instance = VK_NULL_HANDLE;
  VkDevice device = VK_NULL_HANDLE;
  VkBuffer buffer = VK_NULL_HANDLE;
  VkDeviceMemory memory = VK_NULL_HANDLE;
  VkDescriptorSetLayout set_layout = VK_NULL_HANDLE;
  VkPipelineLayout pipeline_layout = VK_NULL_HANDLE;
  VkShaderModule shader = VK_NULL_HANDLE;
  VkPipeline pipeline = VK_NULL_HANDLE;
  VkDescriptorPool descriptor_pool = VK_NULL_HANDLE;
  VkCommandPool command_pool = VK_NULL_HANDLE;
  VkCommandBuffer cmd = VK_NULL_HANDLE;
  void *mapped = NULL;
  VkPhysicalDevice physical = VK_NULL_HANDLE;
  VkPhysicalDeviceProperties chosen_props = {0};
  uint32_t queue_family = UINT32_MAX;
  VkQueue queue = VK_NULL_HANDLE;
  uint32_t dispatches = 0;

  VkApplicationInfo app = {0};
  app.sType = VK_STRUCTURE_TYPE_APPLICATION_INFO;
  app.pApplicationName = "D'AUBE Phone Edge Persistent Batch";
  app.applicationVersion = VK_MAKE_VERSION(1, 0, 0);
  app.pEngineName = "daube-phone-edge-gpu";
  app.engineVersion = VK_MAKE_VERSION(5, 0, 0);
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

  const VkDeviceSize tile_bytes = (VkDeviceSize)TILE_PIXELS * sizeof(uint32_t);
  VkBufferCreateInfo bci = {0};
  bci.sType = VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO;
  bci.size = tile_bytes;
  bci.usage = VK_BUFFER_USAGE_STORAGE_BUFFER_BIT;
  bci.sharingMode = VK_SHARING_MODE_EXCLUSIVE;
  CHECK_VK(vkCreateBuffer(device, &bci, NULL, &buffer), "vkCreateBuffer");
  VkMemoryRequirements mem_req;
  vkGetBufferMemoryRequirements(device, buffer, &mem_req);
  uint32_t mem_type = find_memory_type(physical, mem_req.memoryTypeBits, VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT);
  if (mem_type == UINT32_MAX) { fprintf(stderr, "no_host_visible_coherent_memory\n"); rc = 7; goto cleanup; }
  VkMemoryAllocateInfo mai = {0};
  mai.sType = VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO;
  mai.allocationSize = mem_req.size;
  mai.memoryTypeIndex = mem_type;
  CHECK_VK(vkAllocateMemory(device, &mai, NULL, &memory), "vkAllocateMemory");
  CHECK_VK(vkBindBufferMemory(device, buffer, memory, 0), "vkBindBufferMemory");
  CHECK_VK(vkMapMemory(device, memory, 0, tile_bytes, 0, &mapped), "vkMapMemory");

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
  smci.codeSize = daube_rgba_premultiply_spv_len;
  smci.pCode = (const uint32_t *)daube_rgba_premultiply_spv;
  CHECK_VK(vkCreateShaderModule(device, &smci, NULL, &shader), "vkCreateShaderModule");
  VkPipelineShaderStageCreateInfo stage = {0};
  stage.sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
  stage.stage = VK_SHADER_STAGE_COMPUTE_BIT;
  stage.module = shader;
  stage.pName = "main";
  VkComputePipelineCreateInfo cpci = {0};
  cpci.sType = VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO;
  cpci.stage = stage;
  cpci.layout = pipeline_layout;
  CHECK_VK(vkCreateComputePipelines(device, VK_NULL_HANDLE, 1, &cpci, NULL, &pipeline), "vkCreateComputePipelines");

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
  VkDescriptorBufferInfo dbi = {buffer, 0, tile_bytes};
  VkWriteDescriptorSet write = {0};
  write.sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
  write.dstSet = descriptor;
  write.dstBinding = 0;
  write.descriptorCount = 1;
  write.descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
  write.pBufferInfo = &dbi;
  vkUpdateDescriptorSets(device, 1, &write, 0, NULL);

  VkCommandPoolCreateInfo pci = {0};
  pci.sType = VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO;
  pci.flags = VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT;
  pci.queueFamilyIndex = queue_family;
  CHECK_VK(vkCreateCommandPool(device, &pci, NULL, &command_pool), "vkCreateCommandPool");
  VkCommandBufferAllocateInfo cbai = {0};
  cbai.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO;
  cbai.commandPool = command_pool;
  cbai.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY;
  cbai.commandBufferCount = 1;
  CHECK_VK(vkAllocateCommandBuffers(device, &cbai, &cmd), "vkAllocateCommandBuffers");

  for (uint32_t offset = 0; offset < total_pixels; offset += TILE_PIXELS) {
    const uint32_t tile_count = (total_pixels - offset) > TILE_PIXELS ? TILE_PIXELS : (total_pixels - offset);
    const size_t copy_bytes = (size_t)tile_count * sizeof(uint32_t);
    memcpy(mapped, input_words + offset, copy_bytes);
    CHECK_VK(vkResetCommandBuffer(cmd, 0), "vkResetCommandBuffer");
    VkCommandBufferBeginInfo begin = {0};
    begin.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO;
    begin.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
    CHECK_VK(vkBeginCommandBuffer(cmd, &begin), "vkBeginCommandBuffer");
    vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, pipeline);
    vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, pipeline_layout, 0, 1, &descriptor, 0, NULL);
    vkCmdPushConstants(cmd, pipeline_layout, VK_SHADER_STAGE_COMPUTE_BIT, 0, sizeof(tile_count), &tile_count);
    vkCmdDispatch(cmd, (tile_count + 63u) / 64u, 1, 1);
    VkMemoryBarrier barrier = {0};
    barrier.sType = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
    barrier.srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
    barrier.dstAccessMask = VK_ACCESS_HOST_READ_BIT;
    vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_PIPELINE_STAGE_HOST_BIT, 0, 1, &barrier, 0, NULL, 0, NULL);
    CHECK_VK(vkEndCommandBuffer(cmd), "vkEndCommandBuffer");
    VkSubmitInfo submit = {0};
    submit.sType = VK_STRUCTURE_TYPE_SUBMIT_INFO;
    submit.commandBufferCount = 1;
    submit.pCommandBuffers = &cmd;
    CHECK_VK(vkQueueSubmit(queue, 1, &submit, VK_NULL_HANDLE), "vkQueueSubmit");
    CHECK_VK(vkQueueWaitIdle(queue), "vkQueueWaitIdle");
    memcpy(output_words + offset, mapped, copy_bytes);
    ++dispatches;
  }

  if (write_output(argv[2], output_words, (size_t)total_pixels * sizeof(uint32_t)) != 0) { fprintf(stderr, "output_write_failed\n"); rc = 8; goto cleanup; }

  printf("{\"schema\":\"daube.vulkan-rgba-premultiply-batch-result.v1\",\"passed\":true,\"hardwareGpu\":true,\"softwareRenderer\":false,\"backend\":\"vulkan\",\"kernelId\":\"rgba-premultiply-u8-v1\",\"totalPixels\":%u,\"tilePixels\":%u,\"dispatches\":%u,\"contextCreates\":1,\"pipelineCreates\":1,\"contextReusedAcrossTiles\":true,\"deviceName\":", total_pixels, TILE_PIXELS, dispatches);
  json_string(chosen_props.deviceName);
  printf(",\"deviceType\":%u,\"vendorId\":%u,\"deviceId\":%u,\"apiVersion\":%u,\"queueFamily\":%u,\"computeQueue\":true,\"privateAssetsUsed\":false,\"paidSpendAuthorized\":false}\n",
    (unsigned)chosen_props.deviceType, chosen_props.vendorID, chosen_props.deviceID, chosen_props.apiVersion, queue_family);
  rc = 0;

cleanup:
  if (device != VK_NULL_HANDLE) vkDeviceWaitIdle(device);
  if (mapped && device != VK_NULL_HANDLE && memory != VK_NULL_HANDLE) vkUnmapMemory(device, memory);
  if (command_pool != VK_NULL_HANDLE && device != VK_NULL_HANDLE) vkDestroyCommandPool(device, command_pool, NULL);
  if (descriptor_pool != VK_NULL_HANDLE && device != VK_NULL_HANDLE) vkDestroyDescriptorPool(device, descriptor_pool, NULL);
  if (pipeline != VK_NULL_HANDLE && device != VK_NULL_HANDLE) vkDestroyPipeline(device, pipeline, NULL);
  if (shader != VK_NULL_HANDLE && device != VK_NULL_HANDLE) vkDestroyShaderModule(device, shader, NULL);
  if (pipeline_layout != VK_NULL_HANDLE && device != VK_NULL_HANDLE) vkDestroyPipelineLayout(device, pipeline_layout, NULL);
  if (set_layout != VK_NULL_HANDLE && device != VK_NULL_HANDLE) vkDestroyDescriptorSetLayout(device, set_layout, NULL);
  if (buffer != VK_NULL_HANDLE && device != VK_NULL_HANDLE) vkDestroyBuffer(device, buffer, NULL);
  if (memory != VK_NULL_HANDLE && device != VK_NULL_HANDLE) vkFreeMemory(device, memory, NULL);
  if (device != VK_NULL_HANDLE) vkDestroyDevice(device, NULL);
  if (instance != VK_NULL_HANDLE) vkDestroyInstance(instance, NULL);
  free(output_words);
  free(input_words);
  return rc;
}

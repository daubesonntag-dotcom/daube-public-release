#include <vulkan/vulkan.h>
#include <ctype.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "canary_spv.h"

#define CHECK_VK(expr, code) do { VkResult _r = (expr); if (_r != VK_SUCCESS) { fprintf(stderr, "%s:%d\n", code, (int)_r); return 2; } } while (0)

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

int main(void) {
  VkApplicationInfo app = {0};
  app.sType = VK_STRUCTURE_TYPE_APPLICATION_INFO;
  app.pApplicationName = "D'AUBE Vulkan Compute Canary";
  app.applicationVersion = VK_MAKE_VERSION(1, 0, 0);
  app.pEngineName = "daube-sovereign-gpu";
  app.engineVersion = VK_MAKE_VERSION(1, 0, 0);
  app.apiVersion = VK_API_VERSION_1_0;

  VkInstanceCreateInfo ici = {0};
  ici.sType = VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO;
  ici.pApplicationInfo = &app;
  VkInstance instance = VK_NULL_HANDLE;
  CHECK_VK(vkCreateInstance(&ici, NULL, &instance), "vkCreateInstance");

  uint32_t device_count = 0;
  CHECK_VK(vkEnumeratePhysicalDevices(instance, &device_count, NULL), "vkEnumeratePhysicalDevices.count");
  if (!device_count) { fprintf(stderr, "no_vulkan_physical_device\n"); vkDestroyInstance(instance, NULL); return 3; }
  VkPhysicalDevice *devices = calloc(device_count, sizeof(*devices));
  if (!devices) { vkDestroyInstance(instance, NULL); return 4; }
  CHECK_VK(vkEnumeratePhysicalDevices(instance, &device_count, devices), "vkEnumeratePhysicalDevices.list");

  VkPhysicalDevice physical = VK_NULL_HANDLE;
  VkPhysicalDeviceProperties chosen_props = {0};
  uint32_t queue_family = UINT32_MAX;
  for (uint32_t d = 0; d < device_count && physical == VK_NULL_HANDLE; ++d) {
    VkPhysicalDeviceProperties props;
    vkGetPhysicalDeviceProperties(devices[d], &props);
    if (props.deviceType == VK_PHYSICAL_DEVICE_TYPE_CPU || contains_ci(props.deviceName, "llvmpipe") || contains_ci(props.deviceName, "lavapipe") || contains_ci(props.deviceName, "swiftshader")) continue;
    uint32_t qcount = 0;
    vkGetPhysicalDeviceQueueFamilyProperties(devices[d], &qcount, NULL);
    VkQueueFamilyProperties *qprops = calloc(qcount, sizeof(*qprops));
    if (!qprops) continue;
    vkGetPhysicalDeviceQueueFamilyProperties(devices[d], &qcount, qprops);
    for (uint32_t q = 0; q < qcount; ++q) {
      if ((qprops[q].queueFlags & VK_QUEUE_COMPUTE_BIT) && qprops[q].queueCount > 0) {
        physical = devices[d]; chosen_props = props; queue_family = q; break;
      }
    }
    free(qprops);
  }
  free(devices);
  if (physical == VK_NULL_HANDLE || queue_family == UINT32_MAX) { fprintf(stderr, "no_hardware_compute_gpu\n"); vkDestroyInstance(instance, NULL); return 5; }

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
  VkDevice device = VK_NULL_HANDLE;
  CHECK_VK(vkCreateDevice(physical, &dci, NULL, &device), "vkCreateDevice");
  VkQueue queue = VK_NULL_HANDLE;
  vkGetDeviceQueue(device, queue_family, 0, &queue);

  VkBufferCreateInfo bci = {0};
  bci.sType = VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO;
  bci.size = sizeof(uint32_t) * 4;
  bci.usage = VK_BUFFER_USAGE_STORAGE_BUFFER_BIT;
  bci.sharingMode = VK_SHARING_MODE_EXCLUSIVE;
  VkBuffer buffer = VK_NULL_HANDLE;
  CHECK_VK(vkCreateBuffer(device, &bci, NULL, &buffer), "vkCreateBuffer");
  VkMemoryRequirements mem_req;
  vkGetBufferMemoryRequirements(device, buffer, &mem_req);
  uint32_t mem_type = find_memory_type(physical, mem_req.memoryTypeBits, VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT);
  if (mem_type == UINT32_MAX) { fprintf(stderr, "no_host_visible_coherent_memory\n"); return 6; }
  VkMemoryAllocateInfo mai = {0};
  mai.sType = VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO;
  mai.allocationSize = mem_req.size;
  mai.memoryTypeIndex = mem_type;
  VkDeviceMemory memory = VK_NULL_HANDLE;
  CHECK_VK(vkAllocateMemory(device, &mai, NULL, &memory), "vkAllocateMemory");
  CHECK_VK(vkBindBufferMemory(device, buffer, memory, 0), "vkBindBufferMemory");
  void *mapped = NULL;
  CHECK_VK(vkMapMemory(device, memory, 0, VK_WHOLE_SIZE, 0, &mapped), "vkMapMemory");
  memset(mapped, 0, sizeof(uint32_t) * 4);

  VkDescriptorSetLayoutBinding binding = {0};
  binding.binding = 0;
  binding.descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
  binding.descriptorCount = 1;
  binding.stageFlags = VK_SHADER_STAGE_COMPUTE_BIT;
  VkDescriptorSetLayoutCreateInfo dlci = {0};
  dlci.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
  dlci.bindingCount = 1;
  dlci.pBindings = &binding;
  VkDescriptorSetLayout set_layout = VK_NULL_HANDLE;
  CHECK_VK(vkCreateDescriptorSetLayout(device, &dlci, NULL, &set_layout), "vkCreateDescriptorSetLayout");

  VkPipelineLayoutCreateInfo plci = {0};
  plci.sType = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO;
  plci.setLayoutCount = 1;
  plci.pSetLayouts = &set_layout;
  VkPipelineLayout pipeline_layout = VK_NULL_HANDLE;
  CHECK_VK(vkCreatePipelineLayout(device, &plci, NULL, &pipeline_layout), "vkCreatePipelineLayout");

  VkShaderModuleCreateInfo smci = {0};
  smci.sType = VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO;
  smci.codeSize = daube_canary_spv_len;
  smci.pCode = (const uint32_t *)daube_canary_spv;
  VkShaderModule shader = VK_NULL_HANDLE;
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
  VkPipeline pipeline = VK_NULL_HANDLE;
  CHECK_VK(vkCreateComputePipelines(device, VK_NULL_HANDLE, 1, &cpci, NULL, &pipeline), "vkCreateComputePipelines");

  VkDescriptorPoolSize pool_size = {VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1};
  VkDescriptorPoolCreateInfo dpci = {0};
  dpci.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO;
  dpci.maxSets = 1;
  dpci.poolSizeCount = 1;
  dpci.pPoolSizes = &pool_size;
  VkDescriptorPool pool = VK_NULL_HANDLE;
  CHECK_VK(vkCreateDescriptorPool(device, &dpci, NULL, &pool), "vkCreateDescriptorPool");
  VkDescriptorSetAllocateInfo dsai = {0};
  dsai.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO;
  dsai.descriptorPool = pool;
  dsai.descriptorSetCount = 1;
  dsai.pSetLayouts = &set_layout;
  VkDescriptorSet descriptor = VK_NULL_HANDLE;
  CHECK_VK(vkAllocateDescriptorSets(device, &dsai, &descriptor), "vkAllocateDescriptorSets");
  VkDescriptorBufferInfo dbi = {buffer, 0, sizeof(uint32_t) * 4};
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
  pci.queueFamilyIndex = queue_family;
  VkCommandPool command_pool = VK_NULL_HANDLE;
  CHECK_VK(vkCreateCommandPool(device, &pci, NULL, &command_pool), "vkCreateCommandPool");
  VkCommandBufferAllocateInfo cbai = {0};
  cbai.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO;
  cbai.commandPool = command_pool;
  cbai.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY;
  cbai.commandBufferCount = 1;
  VkCommandBuffer cmd = VK_NULL_HANDLE;
  CHECK_VK(vkAllocateCommandBuffers(device, &cbai, &cmd), "vkAllocateCommandBuffers");
  VkCommandBufferBeginInfo begin = {0};
  begin.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO;
  CHECK_VK(vkBeginCommandBuffer(cmd, &begin), "vkBeginCommandBuffer");
  vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, pipeline);
  vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, pipeline_layout, 0, 1, &descriptor, 0, NULL);
  vkCmdDispatch(cmd, 4, 1, 1);
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

  const uint32_t expected[4] = {0xDA00005Au, 0xDA00015Bu, 0xDA00025Cu, 0xDA00035Du};
  uint32_t observed[4];
  memcpy(observed, mapped, sizeof(observed));
  int passed = memcmp(expected, observed, sizeof(expected)) == 0;

  printf("{\"schema\":\"daube.vulkan-compute-canary.v1\",\"passed\":%s,\"hardwareGpu\":true,\"softwareRenderer\":false,\"backend\":\"vulkan\",\"deviceName\":", passed ? "true" : "false");
  json_string(chosen_props.deviceName);
  printf(",\"deviceType\":%u,\"vendorId\":%u,\"deviceId\":%u,\"apiVersion\":%u,\"queueFamily\":%u,\"computeQueue\":true,\"observed\":[%u,%u,%u,%u]}\n",
    (unsigned)chosen_props.deviceType, chosen_props.vendorID, chosen_props.deviceID, chosen_props.apiVersion, queue_family,
    observed[0], observed[1], observed[2], observed[3]);

  vkDeviceWaitIdle(device);
  vkUnmapMemory(device, memory);
  vkDestroyCommandPool(device, command_pool, NULL);
  vkDestroyDescriptorPool(device, pool, NULL);
  vkDestroyPipeline(device, pipeline, NULL);
  vkDestroyShaderModule(device, shader, NULL);
  vkDestroyPipelineLayout(device, pipeline_layout, NULL);
  vkDestroyDescriptorSetLayout(device, set_layout, NULL);
  vkDestroyBuffer(device, buffer, NULL);
  vkFreeMemory(device, memory, NULL);
  vkDestroyDevice(device, NULL);
  vkDestroyInstance(instance, NULL);
  return passed ? 0 : 7;
}

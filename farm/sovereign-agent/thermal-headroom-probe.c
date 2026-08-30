#define _GNU_SOURCE
#include <dlfcn.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>

typedef struct AThermalManager AThermalManager;
typedef AThermalManager *(*acquire_manager_fn)(void);
typedef void (*release_manager_fn)(AThermalManager *manager);
typedef int (*get_status_fn)(AThermalManager *manager);
typedef float (*get_headroom_fn)(AThermalManager *manager, int forecast_seconds);

static const char *status_name(int status) {
    switch (status) {
        case 0: return "NONE";
        case 1: return "LIGHT";
        case 2: return "MODERATE";
        case 3: return "SEVERE";
        case 4: return "CRITICAL";
        case 5: return "EMERGENCY";
        case 6: return "SHUTDOWN";
        default: return "ERROR";
    }
}

static void unsupported(const char *reason) {
    printf("{\"schema\":\"daube.android-thermal-headroom.v1\",\"supported\":false,\"reason\":\"%s\",\"thermalStatus\":null,\"thermalStatusCode\":null,\"headroomForecastSeconds\":10,\"headroom\":null}\n", reason);
}

int main(void) {
    void *library = dlopen("libandroid.so", RTLD_NOW | RTLD_LOCAL);
    if (library == NULL) {
        unsupported("libandroid_unavailable");
        return 0;
    }

    acquire_manager_fn acquire_manager = (acquire_manager_fn)dlsym(library, "AThermal_acquireManager");
    release_manager_fn release_manager = (release_manager_fn)dlsym(library, "AThermal_releaseManager");
    get_status_fn get_status = (get_status_fn)dlsym(library, "AThermal_getCurrentThermalStatus");
    get_headroom_fn get_headroom = (get_headroom_fn)dlsym(library, "AThermal_getThermalHeadroom");

    if (acquire_manager == NULL || release_manager == NULL || get_status == NULL) {
        dlclose(library);
        unsupported("thermal_api_unavailable");
        return 0;
    }

    AThermalManager *manager = acquire_manager();
    if (manager == NULL) {
        dlclose(library);
        unsupported("thermal_manager_unavailable");
        return 0;
    }

    const int status = get_status(manager);
    float headroom = NAN;
    if (get_headroom != NULL) {
        headroom = get_headroom(manager, 10);
    }

    if (isfinite(headroom) && headroom >= 0.0f) {
        printf("{\"schema\":\"daube.android-thermal-headroom.v1\",\"supported\":true,\"thermalStatus\":\"%s\",\"thermalStatusCode\":%d,\"headroomForecastSeconds\":10,\"headroom\":%.6f}\n",
               status_name(status), status, headroom);
    } else {
        printf("{\"schema\":\"daube.android-thermal-headroom.v1\",\"supported\":true,\"thermalStatus\":\"%s\",\"thermalStatusCode\":%d,\"headroomForecastSeconds\":10,\"headroom\":null}\n",
               status_name(status), status);
    }

    release_manager(manager);
    dlclose(library);
    return 0;
}

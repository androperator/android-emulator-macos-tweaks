#include <mach-o/dyld.h>
#include <limits.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>
#ifndef AVD_NAME
#error AVD_NAME is required
#endif
int main(int argc, char **argv) {
    char loaded[PATH_MAX], executable[PATH_MAX];
    uint32_t size = sizeof(loaded);
    if (_NSGetExecutablePath(loaded, &size) || !realpath(loaded, executable)) return 1;
    char *slash = strrchr(executable, '/');
    if (!slash || (size_t)(slash - executable + 1) + strlen(AVD_NAME) >= sizeof(executable)) return 1;
    strcpy(slash + 1, AVD_NAME);
    for (int i = 1; i < argc; i++) {
        if ((!strcmp(argv[i], "-avd") && i + 1 < argc && strcmp(argv[i + 1], AVD_NAME)) ||
            (argv[i][0] == '@' && strcmp(argv[i] + 1, AVD_NAME))) {
            fprintf(stderr, "This preview launcher is for %s.\n", AVD_NAME); return 1;
        }
    }
    argv[0] = executable;
    execv(executable, argv);
    perror("Could not start named emulator");
    return 1;
}

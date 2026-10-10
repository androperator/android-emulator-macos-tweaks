#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main(int argc, char **argv) {
    puts(strrchr(argv[0], '/') ? strrchr(argv[0], '/') + 1 : argv[0]);
    puts(getenv("EMULATOR_TWEAKS_TEST_CONTEXT") ?: "missing environment");
    for (int i=1; i<argc; i++) puts(argv[i]);
    return 0;
}

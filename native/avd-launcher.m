#import <Foundation/Foundation.h>
#import <CommonCrypto/CommonDigest.h>
#include <mach-o/dyld.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <spawn.h>
extern char **environ;
#include <unistd.h>
#include <limits.h>

static NSString *hashFile(NSString *path) {
    NSFileHandle *file = [NSFileHandle fileHandleForReadingAtPath:path];
    if (!file) return nil;
    CC_SHA256_CTX context; CC_SHA256_Init(&context);
    for (;;) { NSData *bytes = [file readDataOfLength:65536]; if (!bytes.length) break; CC_SHA256_Update(&context, bytes.bytes, (CC_LONG)bytes.length); }
    [file closeFile]; unsigned char digest[CC_SHA256_DIGEST_LENGTH]; CC_SHA256_Final(digest, &context);
    NSMutableString *result = [NSMutableString string];
    for (int i = 0; i < CC_SHA256_DIGEST_LENGTH; i++) [result appendFormat:@"%02x", digest[i]];
    return result;
}
int main(int argc, char **argv) { @autoreleasepool {
    char loaded[PATH_MAX], executable[PATH_MAX]; uint32_t size = sizeof(loaded);
    if (_NSGetExecutablePath(loaded, &size) || !realpath(loaded, executable)) return 1;
    NSString *target = @(executable);
    NSString *path = [[target stringByDeletingLastPathComponent] stringByAppendingPathComponent:@".emulator-tweaks-launch.json"];
    struct stat info;
    if (lstat(path.fileSystemRepresentation, &info) || !S_ISREG(info.st_mode) || info.st_uid != getuid() || (info.st_mode & 0022)) {
        fprintf(stderr, "Emulator naming configuration is missing or unsafe. Reapply or restore emulator tweaks.\n"); return 1;
    }
    NSDictionary *config = [NSJSONSerialization JSONObjectWithData:[NSData dataWithContentsOfFile:path] options:0 error:nil];
    if (![config isKindOfClass:NSDictionary.class] || ![config[@"target"] isEqual:target] ||
        ![config[@"node"] isKindOfClass:NSString.class] || ![config[@"node"] isAbsolutePath] ||
        ![config[@"script"] isKindOfClass:NSString.class] || ![config[@"script"] isAbsolutePath] ||
        ![hashFile(config[@"script"]) isEqual:config[@"scriptHash"]]) {
        fprintf(stderr, "Emulator naming configuration is invalid or corrupt. Reapply or restore emulator tweaks.\n"); return 1;
    }
    int descriptors[2]; if (pipe(descriptors)) return 1;
    char **arguments = calloc((size_t)argc + 3, sizeof(char *));
    if (!arguments) { close(descriptors[0]); close(descriptors[1]); return 1; }
    arguments[0] = (char *)[config[@"node"] fileSystemRepresentation];
    arguments[1] = (char *)[config[@"script"] fileSystemRepresentation]; arguments[2] = (char *)path.fileSystemRepresentation;
    for (int i = 1; i < argc; i++) arguments[i + 2] = argv[i];
    posix_spawn_file_actions_t actions; posix_spawn_file_actions_init(&actions);
    posix_spawn_file_actions_addclose(&actions, descriptors[0]);
    posix_spawn_file_actions_adddup2(&actions, descriptors[1], STDOUT_FILENO);
    posix_spawn_file_actions_addclose(&actions, descriptors[1]);
    pid_t child; int spawnError = posix_spawn(&child, arguments[0], &actions, NULL, arguments, environ);
    posix_spawn_file_actions_destroy(&actions); free(arguments); close(descriptors[1]);
    if (spawnError) { fprintf(stderr, "Could not prepare named emulator using Node.js: %s. Reapply emulator tweaks if Node moved.\n", strerror(spawnError)); close(descriptors[0]); return 1; }
    char selected[PATH_MAX]; size_t length = 0; ssize_t count;
    while (length < sizeof(selected) - 1 && (count = read(descriptors[0], selected + length, sizeof(selected) - 1 - length)) > 0) length += (size_t)count;
    close(descriptors[0]); int status = 0;
    while (waitpid(child, &status, 0) < 0) { if (errno != EINTR) return 1; }
    if (!WIFEXITED(status) || WEXITSTATUS(status) != 0 || !length || length >= sizeof(selected) - 1) return 1;
    selected[length] = '\0'; if (selected[length - 1] == '\n') selected[--length] = '\0';
    if (selected[0] != '/' || strchr(selected, '\n') || strchr(selected, '\r')) return 1;
    argv[0] = selected; execv(selected, argv); perror("Could not start named emulator"); return 1;
} }

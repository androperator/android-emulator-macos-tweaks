#import <AppKit/AppKit.h>
@interface NSApplication (EmulatorDeviceIcon)
- (void)emulatorIcon_setApplicationIconImage:(NSImage *)image;
@end
int main(int argc, const char *argv[]) {
    @autoreleasepool {
        NSApplication *application = [NSApplication sharedApplication];
        if (getenv("EMULATOR_ICON_NO_HELPER")) return [application respondsToSelector:@selector(emulatorIcon_setApplicationIconImage:)] ? 1 : 0;
        const char *expectedPath = getenv("EMULATOR_ICON_EXPECTED");
        BOOL fallback = getenv("EMULATOR_ICON_FALLBACK") != NULL;
        if (!expectedPath && !fallback) return 2;
        NSImage *expected = fallback ? [[NSImage alloc] initWithSize:NSMakeSize(1, 1)] : [[NSImage alloc] initWithContentsOfFile:[NSString stringWithUTF8String:expectedPath]];
        if (!expected || ![application respondsToSelector:@selector(emulatorIcon_setApplicationIconImage:)]) return 2;
        // Compare against AppKit's normalized image using the exchanged original setter.
        [application emulatorIcon_setApplicationIconImage:expected];
        NSData *reference = application.applicationIconImage.TIFFRepresentation;
        [application setApplicationIconImage:[[NSImage alloc] initWithSize:NSMakeSize(1, 1)]];
        if (![application.applicationIconImage.TIFFRepresentation isEqual:reference]) return 1;
        const char *expectedName = getenv("EMULATOR_ICON_EXPECTED_NAME");
        if (expectedName) {
            NSString *name = [NSString stringWithUTF8String:expectedName];
            NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:2];
            while (![NSRunningApplication.currentApplication.localizedName isEqualToString:name] && deadline.timeIntervalSinceNow > 0) {
                [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
            }
            if (![NSRunningApplication.currentApplication.localizedName isEqualToString:name]) {
                fprintf(stderr, "expected name=%s actual=%s\n", expectedName, (NSRunningApplication.currentApplication.localizedName ?: @"unavailable").UTF8String);
                return 3;
            }
        }
        fprintf(stderr, "[emulator-icon-probe] application icon matches expected variant, application name=%s\n", (NSRunningApplication.currentApplication.localizedName ?: @"unavailable").UTF8String);
        return 0;
    }
}

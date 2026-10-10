#import <AppKit/AppKit.h>
@interface NSApplication (EmulatorDeviceIcon)
- (void)emulatorIcon_setApplicationIconImage:(NSImage *)image;
@end
int main(int argc, const char *argv[]) {
    @autoreleasepool {
        NSApplication *application = [NSApplication sharedApplication];
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
        fprintf(stderr, "[emulator-icon-probe] application icon matches expected variant\n");
        return 0;
    }
}

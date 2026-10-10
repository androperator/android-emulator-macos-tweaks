#import <AppKit/AppKit.h>
#import <objc/runtime.h>
#import <dlfcn.h>

static NSDictionary *ReadConfiguration(NSString *path) {
    if (!path) return @{};
    NSString *text = [NSString stringWithContentsOfFile:path encoding:NSUTF8StringEncoding error:NULL];
    NSMutableDictionary *values = [NSMutableDictionary dictionary];
    for (NSString *line in [text componentsSeparatedByCharactersInSet:NSCharacterSet.newlineCharacterSet]) {
        NSRange equals = [line rangeOfString:@"="];
        if (equals.location == NSNotFound || [line hasPrefix:@"#"] || [line hasPrefix:@";"]) continue;
        NSString *key = [[line substringToIndex:equals.location] stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet];
        NSString *value = [[line substringFromIndex:equals.location + 1] stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet];
        values[key] = value;
    }
    return values;
}

static NSString *Variant(NSDictionary *values) {
    NSString *tags = [[NSString stringWithFormat:@"%@ %@ %@", values[@"tag.id"] ?: @"", values[@"tag.ids"] ?: @"", values[@"image.sysdir.1"] ?: @""] lowercaseString];
    NSString *device = [values[@"hw.device.name"] lowercaseString] ?: @"";
    if ([tags containsString:@"android-wear"] || [device hasPrefix:@"wear"] || [device containsString:@"watch"]) return @"watch";
    if ([tags containsString:@"android-tv"] || [tags containsString:@"google-tv"] || [device hasPrefix:@"tv_"]) return @"tv";
    if ([tags containsString:@"automotive"] || [device containsString:@"automotive"]) return @"automotive";
    if ([device containsString:@"tablet"] || [@[@"nexus_7", @"nexus_9", @"nexus_10", @"pixel_c"] containsObject:device]) return @"tablet";
    double width = [values[@"hw.lcd.width"] doubleValue], height = [values[@"hw.lcd.height"] doubleValue], density = [values[@"hw.lcd.density"] doubleValue];
    if (![device containsString:@"fold"] && density > 0 && MIN(width, height) * 160.0 / density >= 600.0) return @"tablet";
    return @"phone";
}

static NSString *ConfigurationPath(void) {
    NSArray *arguments = NSProcessInfo.processInfo.arguments;
    NSDictionary *environment = NSProcessInfo.processInfo.environment;
    NSString *avd = nil;
    for (NSUInteger index = 1; index < arguments.count; index++) {
        NSString *argument = arguments[index];
        if ([argument isEqualToString:@"-avd"] && index + 1 < arguments.count) avd = arguments[++index];
        else if ([argument isEqualToString:@"-datadir"] && index + 1 < arguments.count) index++;
        else if ([argument hasPrefix:@"@"] && argument.length > 1) avd = [argument substringFromIndex:1];
    }
    if (!avd || [avd containsString:@"/"] || [avd isEqualToString:@".."] || [avd isEqualToString:@"."]) return nil;
    NSString *userHome = environment[@"ANDROID_USER_HOME"] ?: [NSHomeDirectory() stringByAppendingPathComponent:@".android"];
    NSMutableArray *roots = [NSMutableArray array];
    if (environment[@"ANDROID_AVD_HOME"]) [roots addObject:environment[@"ANDROID_AVD_HOME"]];
    if (environment[@"ANDROID_EMULATOR_HOME"]) [roots addObject:[environment[@"ANDROID_EMULATOR_HOME"] stringByAppendingPathComponent:@"avd"]];
    [roots addObject:[userHome stringByAppendingPathComponent:@"avd"]];
    for (NSString *root in roots) {
        NSDictionary *pointer = ReadConfiguration([root stringByAppendingPathComponent:[avd stringByAppendingString:@".ini"]]);
        NSString *directory = nil;
        BOOL isDirectory = NO;
        if (pointer[@"path.rel"]) {
            NSString *relative = [[root stringByDeletingLastPathComponent] stringByAppendingPathComponent:pointer[@"path.rel"]];
            if ([NSFileManager.defaultManager fileExistsAtPath:relative isDirectory:&isDirectory] && isDirectory) directory = relative;
        }
        if (!directory) directory = pointer[@"path"];
        if (!directory) directory = [root stringByAppendingPathComponent:[avd stringByAppendingString:@".avd"]];
        NSString *path = [directory stringByAppendingPathComponent:@"config.ini"];
        if ([NSFileManager.defaultManager fileExistsAtPath:path]) return path;
    }
    return nil;
}

static NSImage *SelectedIcon(void) {
    static NSImage *icon;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        Dl_info location;
        if (!dladdr((const void *)&SelectedIcon, &location) || !location.dli_fname) return;
        NSString *directory = [[NSString stringWithUTF8String:location.dli_fname] stringByDeletingLastPathComponent];
        NSString *config = ConfigurationPath();
        NSString *variant = Variant(ReadConfiguration(config));
        NSString *path = [directory stringByAppendingPathComponent:[NSString stringWithFormat:@"icons/%@.png", variant]];
        icon = [[NSImage alloc] initWithContentsOfFile:path];
        if (icon) fprintf(stderr, "[emulator-icon] variant=%s config=%s\n", variant.UTF8String, (config ?: @"unavailable").UTF8String);
    });
    return icon;
}

@interface NSApplication (EmulatorDeviceIcon)
- (void)emulatorIcon_setApplicationIconImage:(NSImage *)image;
@end
@implementation NSApplication (EmulatorDeviceIcon)
+ (void)load {
    Method original = class_getInstanceMethod(self, @selector(setApplicationIconImage:));
    Method replacement = class_getInstanceMethod(self, @selector(emulatorIcon_setApplicationIconImage:));
    if (original && replacement) method_exchangeImplementations(original, replacement);
    dispatch_async(dispatch_get_main_queue(), ^{ if (NSApp && SelectedIcon()) [NSApp setApplicationIconImage:SelectedIcon()]; });
}
- (void)emulatorIcon_setApplicationIconImage:(NSImage *)image {
    [self emulatorIcon_setApplicationIconImage:SelectedIcon() ?: image];
}
@end

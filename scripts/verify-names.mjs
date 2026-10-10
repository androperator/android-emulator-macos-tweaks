import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,copyFile,chmod,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {sha256} from '../src/png.js';
const execute=promisify(execFile);
const root=fileURLToPath(new URL('../',import.meta.url));
const temporary=await realpath(await mkdtemp(join(tmpdir(),'emulator-tweaks-native-names-')));
try {
 const sdk=join(temporary,'SDK with spaces');
 const directory=join(temporary,'immutable backup');await mkdir(directory);
 const target=join(sdk,'emulator/qemu/darwin-aarch64/qemu-system-aarch64');await mkdir(dirname(target),{recursive:true});
 await writeFile(join(sdk,'emulator/source.properties'),'Pkg.Revision=37.1.11\n');
 const backend=join(directory,'backend');
 await execute('/usr/bin/xcrun',['clang','-arch','arm64',join(root,'native/naming-probe.c'),'-o',backend]);
 await execute('/usr/bin/codesign',['--force','--sign','-',backend]);
 await copyFile(join(root,'assets/launcher/launcher'),target);await chmod(target,0o755);
 const script=join(directory,'launch.mjs');await copyFile(join(root,'src/launch.mjs'),script);
 const config={schema:1,sdk,target,directory,revision:'37.1.11',node:process.execPath,script,backend,backendHash:sha256(await readFile(backend)),scriptHash:sha256(await readFile(script))};
 const path=join(dirname(target),'.emulator-tweaks-launch.json');await writeFile(path,JSON.stringify(config),{mode:0o600});
 const env={...process.env,PATH:'/usr/bin:/bin',EMULATOR_TWEAKS_TEST_CONTEXT:'preserved value with spaces'};
 const cases=[['-avd','Pixel_9','-datadir','two words'],['@Watch_API_35','-port','5580'],['-avd','Headless','-no-window'],['--version']];
 for(const args of cases){
  const {stdout}=await execute(target,args,{env});
  const lines=stdout.trimEnd().split('\n');
  assert.equal(lines[0],args.includes('-no-window')||args[0]==='--version'?'qemu-system-aarch64':args[0]==='-avd'?args[1]:args[0].slice(1));
  assert.equal(lines[1],env.EMULATOR_TWEAKS_TEST_CONTEXT);assert.deepEqual(lines.slice(2),args);
 }
 await Promise.all(Array.from({length:3},()=>execute(target,['-avd','Concurrent_AVD'],{env})));
 await assert.rejects(execute(target,['-avd','../escape'],{env}));
 await writeFile(script,'corrupt');await assert.rejects(execute(target,['-avd','Pixel_9'],{env}));
 console.log('Native dispatcher verified: names, headless fallback, PATH independence, arguments, environment, concurrent launches and corruption refusal');
} finally {await rm(temporary,{recursive:true,force:true});}

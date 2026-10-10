import {test} from 'node:test';
import assert from 'node:assert/strict';
import {avdName} from '../src/launch.mjs';
test('AVD names accept normal and shorthand arguments and preserve headless launches',()=>{
 assert.equal(avdName(['-avd','Pixel_9','-datadir','/somewhere']),'Pixel_9');
 assert.equal(avdName(['@Watch_35','-port','5580']),'Watch_35');
 assert.equal(avdName(['-avd','Pixel_9','-no-window']),undefined);
 assert.equal(avdName(['--version']),undefined);
 for(const args of [['-avd','../escape'],['@qemu-system-aarch64'],['-avd','Phone','@Other']])assert.throws(()=>avdName(args));
});

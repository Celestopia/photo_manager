import test from 'node:test';
import assert from 'node:assert/strict';
import { mapCoordinates, gpsFromStoredMetadata } from '../src/shared/gps.mjs';
import { createRequire } from 'node:module';
import { allowsViewerGlobalShortcut, allowsViewerHorizontalArrow } from '../src/renderer/domain/viewer-keyboard.mjs';
const require = createRequire(import.meta.url);
const { configureMapNetwork } = require('../src/main/map-network');
const gps = { LatitudeRef: 'N', Latitude: [22, 30, 0], LongitudeRef: 'E', Longitude: [114, 15, 0] };
test('map GPS uses stored DMS directions and accepts zero and rational values', () => {
  assert.deepEqual(mapCoordinates(gps), { latitude: 22.5, longitude: 114.25 });
  assert.deepEqual(mapCoordinates({...gps, LatitudeRef:'S',LongitudeRef:'W'}), {latitude:-22.5,longitude:-114.25});
  assert.deepEqual(mapCoordinates({...gps,Latitude:[0,0,0],Longitude:[0,0,0]}), {latitude:0,longitude:0});
  assert.equal(mapCoordinates({...gps,Latitude:[[22,1],{numerator:30,denominator:1},0]}).latitude,22.5);
  assert.deepEqual(gpsFromStoredMetadata(gps), mapCoordinates(gps));
});
test('invalid GPS does not create a map location', () => {
  for (const input of [null, {}, {...gps, LatitudeRef:null}, {...gps,Latitude:[null,0,0]}, {...gps,Latitude:[91,0,0]}, {...gps,Longitude:[181,0,0]}, {...gps,Latitude:[22,60,0]}, {...gps,Latitude:[[1,0],0,0]}, {...gps,Latitude:[NaN,0,0]}]) assert.equal(mapCoordinates(input),null);
});
test('focused map controls reserve viewer shortcuts', () => {
  const active = {tagName:'DIV',closest: selector => selector.includes('media-gps-map') ? {} : null};
  assert.equal(allowsViewerGlobalShortcut(active),false);
  assert.equal(allowsViewerHorizontalArrow({key:'ArrowRight'},active),false);
});
test('map networking identifies tile requests once per session and restricts attribution links', async () => {
  let registrations=0, handler, filter, open;
  const urls=[];
  const session={webRequest:{onBeforeSendHeaders(f,h){registrations++;filter=f;handler=h;}}};
  const window={webContents:{session,setWindowOpenHandler(h){open=h;}}};
  const deps={app:{getVersion:()=> '0.40.0'},shell:{openExternal:async url=>urls.push(url)}};
  configureMapNetwork(window,deps); configureMapNetwork(window,deps);
  assert.equal(registrations,1); assert.deepEqual(filter.urls,['https://tile.openstreetmap.org/*']);
  handler({requestHeaders:{Accept:'image/png'}},result=>assert.deepEqual(result.requestHeaders,{Accept:'image/png','User-Agent':'PhotoManager/0.40.0'}));
  assert.deepEqual(open({url:'https://example.com'}),{action:'deny'});
  open({url:'https://www.openstreetmap.org/copyright'});
  assert.deepEqual(urls,['https://www.openstreetmap.org/copyright']);
});

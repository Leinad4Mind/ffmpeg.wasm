#!/usr/bin/env node

const fs = require("fs");

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("Usage: patch-opfs-async-access.js <ffmpeg-core.js> [...]");
  process.exit(2);
}

const original = 'class FileSystemAsyncAccessHandle{constructor(handle){this.handle=handle}async close(){}async flush(){}async getSize(){let file=await this.handle.getFile();return file.size}async read(buffer,options={at:0}){let file=await this.handle.getFile();let slice=await file.slice(options.at,options.at+buffer.length);let fileBuffer=await slice.arrayBuffer();let array=new Uint8Array(fileBuffer);buffer.set(array);return array.length}async write(buffer,options={at:0}){let writable=await this.handle.createWritable({keepExistingData:true});await writable.write({type:"write",position:options.at,data:buffer});await writable.close();return buffer.length}async truncate(size){let writable=await this.handle.createWritable({keepExistingData:true});await writable.truncate(size);await writable.close()}}';

const patched = 'class FileSystemAsyncAccessHandle{constructor(handle){this.handle=handle;this.writable=null;this.file=null;this.size=null}async _ensureSize(){if(this.size===null){let file=await this.handle.getFile();this.size=file.size;if(!this.writable)this.file=file}return this.size}async _ensureWritable(){if(!this.writable){await this._ensureSize();this.writable=await this.handle.createWritable({keepExistingData:true});this.file=null}return this.writable}async close(){if(this.writable){let writable=this.writable;this.writable=null;await writable.close();this.file=null}}async flush(){}async getSize(){return await this._ensureSize()}async read(buffer,options={at:0}){if(this.writable)await this.close();let file=this.file;if(!file){file=await this.handle.getFile();this.file=file;this.size=file.size}let slice=await file.slice(options.at,options.at+buffer.length);let fileBuffer=await slice.arrayBuffer();let array=new Uint8Array(fileBuffer);buffer.set(array);return array.length}async write(buffer,options={at:0}){let writable=await this._ensureWritable();await writable.write({type:"write",position:options.at,data:buffer});this.size=Math.max(this.size||0,options.at+buffer.length);return buffer.length}async truncate(size){let writable=await this._ensureWritable();await writable.truncate(size);this.size=size}}';

let failed = false;
for (const file of files) {
  const input = fs.readFileSync(file, "utf8");
  if (input.includes(patched)) {
    console.log(`${file}: already patched`);
    continue;
  }
  if (!input.includes(original)) {
    console.error(`${file}: OPFS async access shim pattern not found`);
    failed = true;
    continue;
  }
  fs.writeFileSync(file, input.replace(original, patched));
  console.log(`${file}: patched`);
}

if (failed) process.exit(1);

import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(f)=>readFileSync(new URL(f,import.meta.url),"utf8");
test("Pages placeholder header contract is scoped, non-disruptive and noindex",()=>{
 const body=read("../surface-fabric/_headers");
 const page=read("../surface-fabric/index.html");
 assert.match(body,/^\/\*\s*$/m);
 assert.match(body,/Strict-Transport-Security: max-age=300/);
 assert.doesNotMatch(body,/includeSubDomains|preload/);
 assert.match(body,/Content-Security-Policy: /);
 for(const directive of ["script-src 'self' 'unsafe-inline'","style-src 'self' 'unsafe-inline'","frame-ancestors 'none'","object-src 'none'","connect-src 'none'"]){
  assert.ok(body.includes(directive),directive);
 }
 assert.match(body,/X-Frame-Options: DENY/);
 assert.match(body,/X-Content-Type-Options: nosniff/);
 assert.match(body,/X-Robots-Tag: noindex/);
 assert.match(page,/<script>/);
 assert.match(page,/<style>/);
});
test("candidate is static only; no client tokens or automatic release",()=>{
 const h=read("../surface-fabric/_headers");
 assert.doesNotMatch(h,/Bearer|api[_-]?key|sb_secret_|ghp_|\$\{|javascript:/i);
 const doc=read("../surface-fabric/HEADER-RELEASE.md");
 assert.match(doc,/HOLD/);
 assert.match(doc,/GitLab/);
 assert.match(doc,/rollback/i);
 assert.match(doc,/dist\/_headers/);
});

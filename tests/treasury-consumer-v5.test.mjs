import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const config = JSON.parse(await fs.readFile("config/resource-treasury-consumer-v1.json", "utf8"));

const asSet = (values = []) => new Set(values);

test("site consumer contract is pinned to canonical V5 merge", () => {
  assert.equal(config.version, "5.0");
  assert.match(config.canonicalSource.resourceTreasuryCommit, /^[0-9a-f]{40}$/);
  assert.equal(config.canonicalSource.resourceTreasuryCommit, "581727154c5cf0763774d29c11dad6ffd16b6ec4");
  assert.equal(config.canonicalSource.resourceRecipes, "config/source-curator/resource-recipes-v5.json");
});

test("direct media and non-renderable production families are disjoint", () => {
  const direct = asSet(config.familyRouting.directMediaFamilies);
  const nonRenderable = asSet(config.familyRouting.nonRenderableKnowledgeOrProductionFamilies);
  for (const family of direct) assert.equal(nonRenderable.has(family), false, `${family} cannot be both direct and non-renderable`);
});

test("high-risk V5 families cannot render directly", () => {
  const nonRenderable = asSet(config.familyRouting.nonRenderableKnowledgeOrProductionFamilies);
  for (const family of ["fabrication", "textile-craft", "archival-cultural", "scientific", "ai-ml", "api-service", "recipe"]) {
    assert.ok(nonRenderable.has(family), `missing non-renderable family ${family}`);
  }
});

test("3D VFX and spatial XR require renderer mediation", () => {
  const mediated = asSet(config.familyRouting.rendererMediatedFamilies);
  for (const family of ["3d", "vfx-cgi", "spatial-xr"]) assert.ok(mediated.has(family));
  assert.equal(config.rules.rendererMediatedFamiliesRequireApprovedRuntimeAndFallback, true);
});

test("recipe definitions never become browser assets directly", () => {
  assert.equal(config.surfaces.recipeOutputs.recipeDefinitionIsRenderable, false);
  assert.equal(config.surfaces.recipeOutputs.mustResolveOutputAssetThroughManifest, true);
  assert.equal(config.rules.recipeDefinitionsAreNeverRenderable, true);
  assert.equal(config.rules.onlyRecipeOutputsThatResolveToApprovedManifestAssetsMayRender, true);
});

test("candidate/source/archive metadata cannot silently become media", () => {
  assert.equal(config.rules.candidateAndResearchRecordsAreNeverRenderable, true);
  assert.equal(config.rules.sourceRecordsAreNeverRenderable, true);
  assert.equal(config.rules.archiveMetadataDoesNotImplyReusableImage, true);
});

test("site audio remains opt-in", () => {
  assert.equal(config.rules.audioAutoplayAllowed, false);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseConfiguration } from "./config.js";

const featureYaml = readFileSync("FEATURES.yaml", "utf8");
const hospitalYaml = readFileSync("HOSPITAL_CONFIG.yaml", "utf8");

test("loads the current demo configuration and customer identity", () => {
  const configuration = parseConfiguration(featureYaml, hospitalYaml);
  assert.equal(configuration.features.product.name, "SKDORA Healthcare Platform");
  assert.equal(configuration.hospital.displayName,
    "Dr. Das' Nursing Home & Diagnostic center Pvt.Ltd.");
});

test("rejects duplicate YAML keys", () => {
  assert.throws(() => parseConfiguration(`${featureYaml}\nproduct:\n  name: Other\n`, hospitalYaml));
});

test("rejects enabling booking before its core dependencies exist", () => {
  const enabled = featureYaml.replace("  patients: true", "  patients: false");
  assert.throws(() => parseConfiguration(enabled, hospitalYaml), /require patients and schedules/);
});

test("rejects disabling a core security capability", () => {
  const disabled = featureYaml.replace("  authorization: true", "  authorization: false");
  assert.throws(() => parseConfiguration(disabled, hospitalYaml), /required core foundations/);
});

test("rejects missing customer display name", () => {
  assert.throws(() => parseConfiguration(featureYaml, "hospital:\n  displayName: ''\n"),
    /displayName must be a non-empty string/);
});

test("rejects invalid timezones and unavailable notification delivery", () => {
  assert.throws(() => parseConfiguration(featureYaml.replace("Asia/Kolkata", "Not/AZone"), hospitalYaml), /IANA/);
  assert.throws(() => parseConfiguration(featureYaml.replace("    sms: false", "    sms: true"), hospitalYaml), /not implemented/);
});

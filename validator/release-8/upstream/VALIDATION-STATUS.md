# Official Release 8 resources — not enabled

Source: https://data.health.europa.eu/healthdcat-ap/releases/release-8/

These 50 resources were downloaded from the official validator configuration.
`manifest.json` records source URLs, SHA-256 hashes, resource sizes, and a bundle
profile identifier. Copyright European Union, CC-BY-4.0 as stated in the official
specification. The downloaded RDF files are unmodified.

A local test with pySHACL 0.30.1 rejected a constraint in the access-level shape
files. In shapes/non-public-shapes.ttl (also public/restricted), Dataset_Shape
uses sh:property for a blank node containing sh:or and sh:message but no sh:path.
The runtime error is: "exists but is not a well-formed SHACL PropertyShape".
Consequently this bundle is not enabled and RELEASE8_VALIDATION_PROFILE remains
unset in the integration service. Existing demonstration validation results
must never be treated as Release 8 assessments.

A compatible, verified validator runtime or an agreed corrected ruleset is needed
before enabling Release 8 results. Do not silently patch the official files or
reuse the bundle identifier for modified files. A configured profile must identify
the actual rules run. Keep the complete baseline/access-level/dependency graph
and validate against reviewed positive and negative fixtures before activation.

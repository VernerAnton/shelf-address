import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// No incremental cache override on purpose. Shelf-Address is a personal,
// database-driven tool with no statically cached pages worth persisting, so
// the R2 cache bucket + self-reference service binding the default template
// wires up would be two extra Cloudflare resources to provision for no gain.
// Add `r2IncrementalCache` here if ISR-style caching is ever wanted.
export default defineCloudflareConfig({});

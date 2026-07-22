// Compatibility entrypoint. Build packages/backend first; the supported operator
// interface is scripts/ops/gcp-drive-check.sh --provision-folder.
import '../packages/backend/dist/cli/googleDriveProvisionFolder.js';

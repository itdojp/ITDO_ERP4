import { runApplication } from '../dist/applicationLifecycle.js';

const mode = process.argv[2];
const serverHandle = setInterval(() => {}, 1000);
const releaseServerHandle = () => clearInterval(serverHandle);
const close =
  mode === 'shutdown-failure'
    ? async () => {
        releaseServerHandle();
        throw Object.assign(new Error('fixture-secret-value'), {
          code: 'ECLOSE',
        });
      }
    : () => {
        releaseServerHandle();
        return new Promise(() => {});
      };

process.exitCode = await runApplication({
  shutdownTimeoutMs: mode === 'timeout' ? 100 : 5000,
  start: async () => {
    console.info('lifecycle fixture ready');
    return {
      close,
      log: console,
    };
  },
});

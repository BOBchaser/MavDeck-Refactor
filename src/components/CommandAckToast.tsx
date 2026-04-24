import { onCleanup, onMount } from 'solid-js';
import { useCommandSender, addToast } from '../services';

/**
 * Invisible logic component that listens for command ACK results
 * and displays toast notifications for success / failure.
 *
 * Mount once at the application root (e.g. App.tsx).
 */
export default function CommandAckToast() {
  const commandSender = useCommandSender();

  onMount(() => {
    const unsub = commandSender.onCommandResult(entry => {
      if (entry.success) {
        addToast(`${entry.commandName} accepted`, 'success', 3000);
      } else {
        const msg = entry.error
          ? `${entry.commandName} failed: ${entry.error}`
          : `${entry.commandName} failed`;
        addToast(msg, 'error', 4000);
      }
    });
    onCleanup(unsub);
  });

  return null;
}

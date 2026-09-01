/*
 * Filename: workcenter-command-wire.ts
 * FullPath: modules/projects/subsystem/src/routing/channel/workcenter-command-wire.ts
 * FIND:workcenter-commands
 * TAG:workcenter,process-ingress
 *
 * SW / page fan-out for Work Center commands. View owns the reducer.
 */

import { BROADCAST_CHANNELS, viewBroadcastChannelName } from "../../other/config/Names";

export const WORKCENTER_COMMAND_TYPE = "workcenter-command";

export type WorkCenterWireCommand = { type: string; [key: string]: unknown };

export const postWorkCenterCommand = (command: WorkCenterWireCommand): void => {
    const envelope = { type: WORKCENTER_COMMAND_TYPE, command };
    const names = [BROADCAST_CHANNELS.WORK_CENTER, viewBroadcastChannelName("workcenter")];
    for (const name of names) {
        try {
            const channel = new BroadcastChannel(name);
            channel.postMessage(envelope);
            channel.close();
        } catch {
            /* CRX SW uses chrome.runtime; page bus still listens */
        }
    }
};

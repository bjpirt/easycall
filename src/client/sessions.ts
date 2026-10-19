import type { IceServer } from "../shared/ice";
import type { PeerFactory } from "./peer";
import type { RoomSocket } from "./room-connection";

/** What the receiver's and caller's sessions need from the browser (faked in tests). */
export interface SessionDeps {
  getCamera: () => Promise<MediaStream>;
  getIceServers: () => Promise<IceServer[]>;
  connect: () => RoomSocket;
  createPeer: PeerFactory;
  /** Told the app version the room is running, so an out-of-date page can update. */
  onVersion?: (version: string) => void;
}

export interface Media {
  camera: MediaStream;
  iceServers: IceServer[];
}

export const cameraFailed = "Couldn't start the camera.";

/**
 * Turns on the camera and gets fresh ICE servers for a call, in parallel.
 * `undefined` if the camera can't start (e.g. permission was refused).
 */
export async function startMedia(deps: SessionDeps): Promise<Media | undefined> {
  const iceServers = deps.getIceServers();
  try {
    const camera = await deps.getCamera();
    return { camera, iceServers: await iceServers };
  } catch {
    return undefined;
  }
}

export function stopCamera(camera: MediaStream): void {
  for (const track of camera.getTracks()) track.stop();
}

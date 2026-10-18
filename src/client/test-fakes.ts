import { vi } from "vitest";
import type { Peer, PeerOptions } from "./peer";

export class FakeSocket extends EventTarget {
  send = vi.fn<(data: string) => void>();
  close = vi.fn();

  /** Simulates a message arriving from the room. */
  receive(data: unknown): void {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(data) }));
  }

  sent(): unknown[] {
    return this.send.mock.calls.map(([data]) => JSON.parse(data) as unknown);
  }
}

export type FakeCamera = MediaStream & { stopped: () => boolean };

export function fakeCamera(): FakeCamera {
  const track = { stop: vi.fn() };
  // happy-dom's MediaStream has no getTracks(), so add one.
  return Object.assign(new MediaStream(), {
    getTracks: () => [track as unknown as MediaStreamTrack],
    stopped: () => track.stop.mock.calls.length > 0,
  });
}

export interface FakePeer extends Peer {
  options: PeerOptions;
  call: ReturnType<typeof vi.fn<Peer["call"]>>;
  handle: ReturnType<typeof vi.fn<Peer["handle"]>>;
  close: ReturnType<typeof vi.fn<Peer["close"]>>;
}

export function fakePeer(options: PeerOptions): FakePeer {
  return {
    options,
    call: vi.fn(() => Promise.resolve()),
    handle: vi.fn(() => Promise.resolve()),
    close: vi.fn(),
  };
}

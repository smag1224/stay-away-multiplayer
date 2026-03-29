import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRandomSeating } from '../seatAssignment.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createRandomSeating', () => {
  it('keeps lobby order untouched while producing a separate random seating map', () => {
    const lobbyMembers = [
      { sessionId: 'host', name: 'Host' },
      { sessionId: 'p2', name: 'Player 2' },
      { sessionId: 'p3', name: 'Player 3' },
      { sessionId: 'p4', name: 'Player 4' },
    ];

    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.1)
      .mockReturnValueOnce(0.9)
      .mockReturnValueOnce(0.2);

    const seating = createRandomSeating(lobbyMembers);

    expect(lobbyMembers.map((member) => member.sessionId)).toEqual(['host', 'p2', 'p3', 'p4']);
    expect(seating.seatedMembers.map((member) => member.sessionId)).not.toEqual(['host', 'p2', 'p3', 'p4']);
    expect([...seating.playerIdBySessionId.keys()].sort()).toEqual(['host', 'p2', 'p3', 'p4']);
    expect(seating.playerNames).toEqual(seating.seatedMembers.map((member) => member.name));

    seating.seatedMembers.forEach((member, index) => {
      expect(seating.playerIdBySessionId.get(member.sessionId)).toBe(index);
    });
  });
});

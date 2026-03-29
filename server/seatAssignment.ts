import { shuffle } from '../src/gameLogic/utils.ts';

export type SeatableMember = {
  sessionId: string;
  name: string;
};

export type RandomSeating<T extends SeatableMember> = {
  seatedMembers: T[];
  playerNames: string[];
  playerIdBySessionId: Map<string, number>;
};

export function createRandomSeating<T extends SeatableMember>(members: T[]): RandomSeating<T> {
  const seatedMembers = shuffle([...members]);
  const playerIdBySessionId = new Map<string, number>();

  seatedMembers.forEach((member, index) => {
    playerIdBySessionId.set(member.sessionId, index);
  });

  return {
    seatedMembers,
    playerNames: seatedMembers.map((member) => member.name),
    playerIdBySessionId,
  };
}

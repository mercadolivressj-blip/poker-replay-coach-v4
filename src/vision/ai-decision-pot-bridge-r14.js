import { activeHandMachine } from '../core/state-machine.js';

const machine = activeHandMachine;
if (machine && !machine.__prcAIDecisionPotBridgeR14) {
  const transactionSetPot = machine.setPot.bind(machine);
  machine.setPot = (value, handId, options = {}) => {
    const source = options?.source === 'ai-decision' ? 'ai-full-frame' : options?.source;
    return transactionSetPot(value, handId, { ...options, source });
  };
  machine.__prcAIDecisionPotBridgeR14 = true;
}

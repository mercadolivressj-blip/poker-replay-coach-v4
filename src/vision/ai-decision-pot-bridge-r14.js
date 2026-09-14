import { activeHandMachine } from '../core/state-machine.js';

// Kept as a compatibility shim for older R14 bootstrap order. The fast
// decision lane now has its own explicit pot authority in the transaction
// runtime; do not disguise it as full-frame evidence.
const machine = activeHandMachine;
if (machine && !machine.__prcAIDecisionPotBridgeR14) {
  const transactionSetPot = machine.setPot.bind(machine);
  machine.setPot = (value, handId, options = {}) => transactionSetPot(value, handId, options);
  machine.__prcAIDecisionPotBridgeR14 = true;
}

// The entry. Deliberately keeps a distinctive function name so that its
// minified frames are easy to recognize in the demonstration.
import { computeAnswer } from './dep.js';

function entryBootstrapWorkload() {
  // Some work so the module shows up in a CPU profile.
  let acc = 0;
  for (let i = 0; i < 1000; i++) {
    acc += computeAnswer(i);
  }
  return acc;
}

console.log(entryBootstrapWorkload());

/* What an email composer actually sends.
 *
 * The To and Cc chips, plus any valid address still sitting typed in a box
 * (someone who types an address and presses Send expects it to go). Text in a
 * box that is not an address stops the send, rather than quietly dropping a
 * person. Nobody appears twice, and To wins over Cc.
 */
import { invalidAddresses, parseAddressList } from './replyRecipients';

export const MAX_RECIPIENTS = 20; // the send functions refuse more than this

export function finalRecipients({ to = [], cc = [], toPending = '', ccPending = '' } = {}) {
  for (const [label, text] of [['To', toPending], ['Cc', ccPending]]) {
    // Any bad part stops the send, even next to good addresses, so nobody is quietly left off.
    const bad = invalidAddresses(text);
    if (bad.length) {
      return { to: [], cc: [], problem: `The ${label} line has "${bad.join(', ')}", which is not an email address. Fix it or delete it.` };
    }
  }
  const seen = new Set();
  const keep = (list) => list.filter((a) => a && a.email && !seen.has(a.email) && seen.add(a.email));
  const toOut = keep([...(to || []), ...parseAddressList(toPending)]);
  const ccOut = keep([...(cc || []), ...parseAddressList(ccPending)]);
  if (!toOut.length) return { to: toOut, cc: ccOut, problem: 'Add at least one email address on the To line.' };
  if (toOut.length + ccOut.length > MAX_RECIPIENTS) return { to: toOut, cc: ccOut, problem: `Too many recipients: ${MAX_RECIPIENTS} at most.` };
  return { to: toOut, cc: ccOut, problem: null };
}

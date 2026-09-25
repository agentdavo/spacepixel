import { registerDockTab } from './DockScreen';
import { CONTACT_ASSIGNMENTS, contactAvailable, contactBlocked, isContactProgress, deliverContact } from '../game/expansion/contact';
import { browserExpansionStorage, loadExpansion } from '../game/expansion/save';
import { interpretContact } from '../content/languages';

registerDockTab({
  id: 'contact', label: 'FIRST CONTACT',
  available: ctx => ctx.station.id.startsWith('marches:') && !ctx.demo,
  mount(panel, ctx, api) {
    const prefs = loadExpansion(browserExpansionStorage).save.preferences;
    const ja = prefs.subtitles === 'ja-JP';
    const notice = document.createElement('p'); notice.setAttribute('role', 'status');
    const say = (text: string, cls: string) => {
      notice.textContent = text; notice.style.color = cls === 'err' ? '#ff5f7a' : '#fff';
      api.say(text, cls);
    };
    const draw = () => {
      panel.replaceChildren();
      const title = document.createElement('h2'); title.textContent = ja ? '最初の交流 — 物資の納入' : 'FIRST CONTACT — SUPPLY AGREEMENTS'; panel.append(title);
      const explanation = document.createElement('p');
      explanation.textContent = ja ? '市場で物資を購入し、指定された星系の港へ届けてください。' : 'Buy supplies in the market, fly to the named system, and deliver at a local port. Both agreements can progress independently.';
      panel.append(explanation, notice);
      if (contactBlocked(ctx.ledger())) {
        notice.textContent = ja ? '交流記録のバージョンに対応していません。記録は保持されています。納入を続けるにはVanguardを更新してください。' : 'Contact records use an unsupported version. Update Vanguard to continue these agreements; saved records are preserved.';
        return;
      }
      for (const a of CONTACT_ASSIGNMENTS) {
        const ledger = ctx.ledger();
        const complete = isContactProgress(ledger.contact) && ledger.contact.completed.includes(a.id);
        const block = document.createElement('section'); block.style.cssText = 'padding:14px;border-bottom:1px solid #344955;max-width:850px';
        const h = document.createElement('h3'); h.textContent = `${complete ? '✓ ' : ''}${ja ? a.jaTitle : a.title}`;
        const text = document.createElement('p'); text.textContent = ja ? a.jaBrief : a.brief;
        const terms = document.createElement('p'); terms.textContent = `${a.system} · ${a.units} ${a.cargo} · ${a.reward} sh · +5 ${a.polity}`;
        block.append(h, text, terms);
        if (contactAvailable(ledger, a)) {
          const button = document.createElement('button'); button.textContent = ja ? '物資を引き渡す' : 'Deliver supplies';
          // Enter activates this action rather than the dock screen's global launch shortcut.
          button.onkeydown = e => { if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') e.stopPropagation(); };
          button.disabled = !ctx.station.id.startsWith(`${a.system}-`) || (ledger.cargo[a.cargo] ?? 0) < a.units;
          button.onclick = () => {
            const result = deliverContact(ctx.ledger(), ctx.station.id, a.id);
            if (result.error) { say(result.error, 'err'); return; }
            if (!ctx.commitLedger?.(result.ledger)) {
              say(ja ? '保存できませんでした。物資と報酬は変更されていません。空き容量を確保してから再試行してください。' : 'Delivery not saved. Cargo and reward are unchanged. Free storage and try again.', 'err');
              return;
            }
            api.refresh();
            const line = interpretContact('contact.thanks', a.polity === 'pelagic' ? 'nacric' : 'orunic', 2, prefs.subtitles);
            say(`${line.text}${prefs.native ? ` / ${line.native}` : ''}`, 'ok'); draw();
          };
          block.append(button);
        }
        panel.append(block);
      }
    };
    draw();
  },
});

// =====================================================
// Members: registration + share holding
// =====================================================
async function getMembers(activeOnly=false){
  let ref = db.collection('members').orderBy('name');
  const snap = await ref.get();
  let list = snap.docs.map(d=>({id:d.id, ...d.data()}));
  if(activeOnly) list = list.filter(m=>m.active !== false);
  return list;
}

async function getMember(id){
  const d = await db.collection('members').doc(id).get();
  return d.exists ? {id:d.id, ...d.data()} : null;
}

async function saveMember(id, data){
  data.shareValue = SOCIETY.shareValue;
  data.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
  if(id){
    await db.collection('members').doc(id).set(data, {merge:true});
    return id;
  } else {
    data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
    data.active = true;
    const ref = await db.collection('members').add(data);
    return ref.id;
  }
}

async function renderMembers(){
  const members = await getMembers();
  const totalShares = members.reduce((s,m)=> s + (m.sharesCount||0), 0);
  document.getElementById('viewMembers').innerHTML = `
    <div class="card">
      <div class="row" style="border:none; padding:0;">
        <h3>Members (${members.length})</h3>
        <button class="btn" onclick="openMemberForm()">+ Add</button>
      </div>
      <div class="meta">Total shares in society: <b>${totalShares}</b> (${fmtMoney(totalShares*SOCIETY.shareValue)}/month if fully paid)</div>
    </div>
    <div class="card ledger">
      ${members.map(m=>`
        <div class="row" style="cursor:pointer;">
          <div onclick="openMemberDetail('${m.id}')" style="flex:1;">
            <div class="who">${escapeHtml(m.name)}</div>
            <div class="meta">${m.sharesCount||0} shares · ${escapeHtml(m.phone||'—')}</div>
          </div>
          <div style="text-align:right;">
            <div class="amount">${fmtMoney((m.sharesCount||0)*SOCIETY.shareValue)}<span style="color:var(--ink-soft);font-size:11px;">/mo</span></div>
            ${m.active===false ? '<span class="pill due">Inactive</span>' : `<button class="btn secondary" style="padding:5px 10px;font-size:12px;margin-top:4px;" onclick="event.stopPropagation(); openCollectPayment('${m.id}')">Collect</button>`}
          </div>
        </div>`).join('') || '<div class="meta">No members yet. Tap + Add to register the first member.</div>'}
    </div>`;
}

function openMemberForm(existing){
  const m = existing || {};
  openModal(`
    <div class="modal-head"><h3>${existing?'Edit Member':'Add Member'}</h3><button class="close" onclick="closeModal()">✕</button></div>
    <label>Full Name</label>
    <input id="mName" value="${escapeHtml(m.name||'')}" placeholder="Member's full name">
    <label>Phone (for WhatsApp reminders)</label>
    <input id="mPhone" value="${escapeHtml(m.phone||'')}" placeholder="10-digit mobile number">
    <label>Number of Shares (₹${SOCIETY.shareValue} each)</label>
    <input id="mShares" type="number" min="1" value="${m.sharesCount||1}">
    <label>Joining Date</label>
    <input id="mJoin" type="date" value="${m.joinDate || new Date().toISOString().slice(0,10)}">
    <label>Address</label>
    <textarea id="mAddress" rows="2">${escapeHtml(m.address||'')}</textarea>
    <button class="btn block" style="margin-top:16px;" onclick="submitMemberForm('${existing?existing.id:''}')">Save Member</button>
  `);
}

async function submitMemberForm(id){
  const name = document.getElementById('mName').value.trim();
  const phone = document.getElementById('mPhone').value.trim();
  const sharesCount = parseInt(document.getElementById('mShares').value || '0');
  const joinDate = document.getElementById('mJoin').value;
  const address = document.getElementById('mAddress').value.trim();
  if(!name || sharesCount < 1){ toast('Enter a name and at least 1 share.'); return; }
  await saveMember(id || null, {name, phone, sharesCount, joinDate, address});
  closeModal();
  toast('Member saved.');
  renderMembers();
  renderDashboard();
}

async function openCollectPayment(id){
 try {
  const m = await getMember(id);
  const mKey = monthKey(new Date());

  // Make sure this month's share due exists.
  await ensureMonthContributions(mKey);
  const contribDoc = await db.collection('contributions').doc(`${id}_${mKey}`).get();
  const contrib = contribDoc.exists ? {id: contribDoc.id, ...contribDoc.data()} : null;
  const shareDue = contrib ? Math.max(contrib.amountDue + (contrib.penaltyAmount||0) - (contrib.amountPaid||0), 0) : 0;

  // Make sure this month's loan interest entry exists (if they have an active loan).
  const loans = await getMemberLoans(id);
  const activeLoan = loans.find(l=>l.status==='active');
  let loanEntry = null;
  if(activeLoan){
    await ensureLoanCaughtUp(activeLoan.id);
    const ledger = await getLoanLedger(activeLoan.id);
    loanEntry = ledger.find(e => e.month === mKey) || null;
  }
  const loanDue = loanEntry ? Math.max(loanEntry.totalDue - (loanEntry.paymentMade||0), 0) : 0;

  openModal(`
    <div class="modal-head"><h3>Collect Payment — ${escapeHtml(m.name)}</h3><button class="close" onclick="closeModal()">✕</button></div>
    <div class="meta" style="margin-bottom:10px;">${monthLabel(mKey)}</div>

    ${contrib ? `
      <label>Share Amount (due ${fmtMoney(shareDue)})</label>
      <input id="cpShareAmt" type="number" value="${shareDue}">
    ` : `<div class="meta">No share due generated for this month yet.</div>`}

    ${activeLoan ? `
      <label style="margin-top:12px;">Loan Amount (due ${fmtMoney(loanDue)})</label>
      <input id="cpLoanAmt" type="number" value="${loanDue}">
    ` : `<div class="meta" style="margin-top:12px;">No active loan for this member.</div>`}

    <button class="btn block" style="margin-top:16px;" onclick="submitCollectPayment('${id}', '${contrib?contrib.id:''}', '${loanEntry?loanEntry.id:''}')">Confirm Payment</button>
  `);
 } catch(err) {
   console.error('openCollectPayment failed:', err);
   toast('Error opening Collect Payment: ' + (err.message || err));
 }
}

async function submitCollectPayment(memberId, contribId, loanEntryId){
 try {
  const shareInput = document.getElementById('cpShareAmt');
  const loanInput = document.getElementById('cpLoanAmt');
  const shareAmt = shareInput ? parseFloat(shareInput.value || '0') : 0;
  const loanAmt = loanInput ? parseFloat(loanInput.value || '0') : 0;

  if(contribId && shareAmt > 0){
    await markContributionPaid(contribId, shareAmt);
  }
  if(loanEntryId && loanAmt > 0){
    await recordLoanPayment(loanEntryId, loanAmt);
  }

  closeModal();
  const parts = [];
  if(shareAmt > 0) parts.push(`share ${fmtMoney(shareAmt)}`);
  if(loanAmt > 0) parts.push(`loan ${fmtMoney(loanAmt)}`);
  toast(parts.length ? `Recorded: ${parts.join(' + ')}.` : 'Nothing entered — no payment recorded.');

  renderDashboard();
  if(document.getElementById('viewMembers').style.display !== 'none') renderMembers();
  if(document.getElementById('viewShares') && document.getElementById('viewShares').style.display !== 'none') loadContributionMonth();
 } catch(err) {
   console.error('submitCollectPayment failed:', err);
   toast('Error recording payment: ' + (err.message || err));
 }
}

async function openMemberDetail(id){
  const m = await getMember(id);
  const yearId = societyYearOf(new Date());
  const months = societyYearMonths(yearId);

  const contribDocs = await Promise.all(
    months.map(mk => db.collection('contributions').doc(`${id}_${mk}`).get())
  );
  const contribByMonth = {};
  contribDocs.forEach((d,i) => { if(d.exists) contribByMonth[months[i]] = d.data(); });

  const totalDueFY = months.reduce((s,mk)=> s + (contribByMonth[mk]
    ? contribByMonth[mk].amountDue + (contribByMonth[mk].penaltyAmount||0) : 0), 0);
  const totalPaidFY = months.reduce((s,mk)=> s + (contribByMonth[mk]?.amountPaid||0), 0);

  const loans = await getMemberLoans(id);
  for(const l of loans){
    const fullLedger = await getLoanLedger(l.id); // full history, sorted by month asc
    const issuanceMonth = fullLedger.length ? fullLedger[0].month : null;
    const ledger = fullLedger.filter(e => e.yearId === yearId);
    for(const e of ledger){
      if(!monthAgg[e.month]) monthAgg[e.month] = {opening:0, interest:0, payment:0, taken:0, closing:0};
      const a = monthAgg[e.month];
      a.opening += e.openingBalance || 0;
      a.interest += e.interest || 0;
      a.payment += e.paymentMade || 0;
      // "Loan Taken" = the original principal in the month it was first
      // issued, PLUS any later top-up amount — i.e. money that actually
      // left the society to the member that month, separate from the
      // running balance/interest-basis shown in "Loan Bal."
      a.taken += (e.month === issuanceMonth ? l.principal : 0) + (e.topupAmount || 0);
      a.closing += e.closingBalance || 0;
      totalInterestFY += e.interest || 0;
    }
  }
  const activeLoan = loans.find(l=>l.status==='active');
  let currentLoanEntry = null;
  if(activeLoan){
    const activeLedger = await getLoanLedger(activeLoan.id);
    currentLoanEntry = activeLedger.find(e => e.month === monthKey(new Date()));
  }
  const loanTable = `
    <div class="detail-table-wrap">
      <table class="detail-table">
        <thead><tr><th>Month</th><th>Share Paid</th><th>Loan Bal.</th><th>Interest</th><th>Repayment</th><th>Loan Taken</th></tr></thead>
        <tbody>
          ${months.map(mk=>{
            const a = monthAgg[mk];
            const paidDate = contribByMonth[mk]?.paidDate || '—';
            if(!a) return `<tr><td>${monthLabel(mk)}</td><td>${paidDate}</td><td class="num" colspan="4">—</td></tr>`;
            return `<tr>
              <td>${monthLabel(mk)}</td>
              <td>${paidDate}</td>
              <td class="num">${fmtMoney(a.opening)}</td>
              <td class="num">${fmtMoney(a.interest)}</td>
              <td class="num">${fmtMoney(a.payment)}</td>
              <td class="num">${a.topup ? fmtMoney(a.topup) : '0'}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;

  openModal(`
    <div class="modal-head"><h3>${escapeHtml(m.name)}</h3><button class="close" onclick="closeModal()">✕</button></div>
    <div class="grid-2">
      <div class="stat"><div class="label">Shares</div><div class="value">${m.sharesCount}</div></div>
      <div class="stat"><div class="label">Monthly Contribution</div><div class="value">${fmtMoney(m.sharesCount*SOCIETY.shareValue)}</div></div>
    </div>
    <div class="section-title">Contact</div>
    <div class="meta">${escapeHtml(m.phone||'No phone on file')} · Joined ${m.joinDate||'—'}</div>
    <button class="btn block" style="margin-top:12px;" onclick="openCollectPayment('${m.id}')">Collect Payment (Share + Loan)</button>

    <div class="section-title" style="margin-top:14px;">Contribution History — FY ${yearId}</div>
    <div class="meta" style="margin-bottom:6px;">Total this FY: paid ${fmtMoney(totalPaidFY)} of ${fmtMoney(totalDueFY)} due</div>
    <div class="detail-table-wrap">
      <table class="detail-table">
        <thead><tr><th>Month</th><th>Due</th><th>Paid</th><th>Status</th></tr></thead>
        <tbody>
          ${months.map(mk=>{
            const c = contribByMonth[mk];
            if(!c) return `<tr><td>${monthLabel(mk)}</td><td class="num" colspan="3">— not generated —</td></tr>`;
            const due = c.amountDue + (c.penaltyAmount||0);
            return `<tr>
              <td>${monthLabel(mk)}</td>
              <td class="num">${fmtMoney(due)}</td>
              <td class="num">${fmtMoney(c.amountPaid||0)}</td>
              <td><span class="pill ${c.status==='paid'?'paid':(c.status==='partial'?'pending':'due')}">${c.status}</span></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>

    <div class="section-title" style="margin-top:14px;">Loan History — FY ${yearId}</div>
    ${activeLoan ? `<div class="meta">Currently active loan — outstanding <b class="amount">${fmtMoney(activeLoan.outstandingBalance)}</b></div>` : `<div class="meta">No active loan.</div>`}
    <div class="meta" style="margin-top:4px; margin-bottom:6px;">Total interest charged this FY: <b>${fmtMoney(totalInterestFY)}</b></div>
    ${loanTable}
    ${currentLoanEntry && currentLoanEntry.status!=='paid' ? `
      <button class="btn block" style="margin-top:10px;" onclick="promptLoanPayment('${currentLoanEntry.id}', ${currentLoanEntry.totalDue - currentLoanEntry.paymentMade})">Record Loan Payment (${monthLabel(currentLoanEntry.month)})</button>
    ` : ''}
    ${activeLoan ? `<button class="btn secondary block" style="margin-top:8px;" onclick="promptLoanTopup('${activeLoan.id}')">+ Top-up Loan</button>` : ''}

    <div style="display:flex; gap:10px; margin-top:16px;">
      <button class="btn secondary block" onclick='openMemberForm(${JSON.stringify(m)})'>Edit</button>
      <button class="btn ${m.active===false?'':'danger'} block" onclick="toggleMemberActive('${m.id}', ${m.active===false})">${m.active===false?'Reactivate':'Deactivate'}</button>
    </div>
    <button class="btn danger block" style="margin-top:10px; background:transparent; color:var(--debit); border:1.5px solid var(--debit);" onclick="openDeleteMemberConfirm('${m.id}', '${escapeHtml(m.name)}')">Delete Member</button>
  `);
}

function openDeleteMemberConfirm(id, name){
  openModal(`
    <div class="modal-head"><h3>Delete Member?</h3><button class="close" onclick="closeModal()">✕</button></div>
    <div class="meta">This permanently removes <b>${name}</b> from the members list. Any contribution or loan records already saved against them will stay in reports, but they'll no longer be billed monthly. This can't be undone.</div>
    <div style="display:flex; gap:10px; margin-top:16px;">
      <button class="btn secondary block" onclick="openMemberDetail('${id}')">Cancel</button>
      <button class="btn danger block" onclick="confirmDeleteMember('${id}')">Yes, Delete</button>
    </div>
  `);
}

async function confirmDeleteMember(id){
  await db.collection('members').doc(id).delete();
  closeModal();
  toast('Member deleted.');
  renderMembers();
  renderDashboard();
}

async function toggleMemberActive(id, makeActive){
  await db.collection('members').doc(id).set({active: makeActive}, {merge:true});
  closeModal();
  toast(makeActive ? 'Member reactivated.' : 'Member deactivated.');
  renderMembers();
}
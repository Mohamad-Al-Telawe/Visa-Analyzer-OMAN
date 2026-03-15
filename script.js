/* script.js — نسخة عُمان الجديدة (تعدد الأيام + الفلاتر البصرية + Logs + الشطب) */

let merged =[];
let branchInfo =[];

// تحميل بيانات الفروع
fetch("information.json")
   .then((r) => r.json())
   .then((data) => {
      branchInfo = data["ورقة1"] || [];
      console.log("🟢 [INIT] Information.json loaded. Branches count:", branchInfo.length);
   })
   .catch((e) => console.error("❌ [ERROR] Failed to load information.json:", e));

/* ======================
   توليد الخانات الديناميكية لـ 10 أيام
   ====================== */
document.addEventListener("DOMContentLoaded", () => {
   const visaContainer = document.getElementById("visa-container");
   const invoiceContainer = document.getElementById("invoice-container");
   let visaHtml = "", invHtml = "";

   for (let i = 1; i <= 10; i++) {
      visaHtml += `
      <div class="day-input-group">
         <label>📅 تاريخ الكشف (${i}): <input type="date" id="visa-date-${i}" /></label>
         <textarea id="visa-text-${i}" rows="3" placeholder="انسخ هنا محتوى التقرير لليوم رقم ${i}..."></textarea>
      </div>`;
      invHtml += `
      <div class="day-input-group">
         <label>📅 تاريخ الفواتير (${i}): <input type="date" id="invoice-date-${i}" /></label>
         <textarea id="invoice-text-${i}" rows="3" placeholder="ألصق هنا نص الفواتير لليوم رقم ${i}..."></textarea>
      </div>`;
   }

   if (visaContainer) visaContainer.innerHTML = visaHtml;
   if (invoiceContainer) invoiceContainer.innerHTML = invHtml;
});

/* ======================
   زر التحليل الأساسي (يقرأ كافة الأيام)
   ====================== */
document.getElementById("analyze-btn").addEventListener("click", () => {
   console.groupCollapsed("🔵 [ACTION] Analyze Button Clicked");
   
   try {
      let allParsedTerminals =[];
      let hasData = false;

      for (let i = 1; i <= 10; i++) {
         const textEl = document.getElementById(`visa-text-${i}`);
         const dateEl = document.getElementById(`visa-date-${i}`);
         
         if (textEl && dateEl && textEl.value.trim() !== "") {
            hasData = true;
            const text = textEl.value;
            const date = dateEl.value;

            if (!date) {
               alert(`الرجاء إدخال التاريخ لتقرير الفيزا رقم ${i}`);
               console.warn(`⚠️ [WARN] Missing date for visa input ${i}`);
               console.groupEnd();
               return;
            }

            console.log(`⏳ [PARSING] Visa Report for Date: ${date} (Input ${i})`);
            const raw = parseMerchantReportOman(text, date);
            console.log(`✔️ [PARSED] Found ${raw.length} terminal blocks for ${date}`);
            allParsedTerminals.push(...raw);
         }
      }

      if (!hasData) {
         alert("الرجاء إدخال محتوى لتقرير واحد على الأقل");
         console.warn("⚠️ [WARN] No data entered in any visa input.");
         console.groupEnd();
         return;
      }

      console.log("📊 [DATA] All raw parsed terminals (unmerged):", allParsedTerminals);

      // دمج التيرمينالات (الآن ندمج مع أخذ التاريخ بعين الاعتبار)
      merged = mergeTerminals(allParsedTerminals);
      console.log("🔗 [DATA] Merged terminals (Grouped by Terminal+Date):", merged);

      renderTotalsTable(merged);

      const select = document.getElementById("terminal-select");
      if (select) {
         select.innerHTML = "";
         populateTerminalSelect(merged);
      }
      
      console.log("✅ [SUCCESS] Analysis completed successfully.");
   } catch (err) {
      console.error("🔴 [FATAL ERROR] In Analyze handler:", err);
      alert("خطأ غير متوقع — راجع الكونسول");
   }
   console.groupEnd();
});

/* ======================
   دالة التحليل (مضاف إليها تمرير التاريخ للترمينال والعمليات)
   ====================== */
function parseMerchantReportOman(text, reportDate) {
   const terminals =[];
   const terminalBlocks = text.split(/Terminal ID:/).slice(1);

   terminalBlocks.forEach((block) => {
      const lines = block.replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean);
      const terminalId = lines[0].trim();
      const transactions =[];
      let totalGross = null, totalNet = null;

      for (let i = 0; i < lines.length; i++) {
         const line = lines[i];
         const cardMatch = line.match(/\*{6}(\d{4})/);
         const netMatch = line.match(/\b\d+\.\d+-\d+\.\d+\s+(\d+\.\d+)\b/);

         if (cardMatch && netMatch) {
            transactions.push({
               terminal: terminalId, 
               cardNumber: cardMatch[1],
               amount: parseFloat(netMatch[1]),
               date: reportDate
            });
         }

         if (/^Total\b/i.test(line) || /^Total\s*/i.test(line)) {
            let collectedNumbers =[];
            let foundNetExplicit = null;
            for (let k = i; k < i + 7 && k < lines.length; k++) {
               const nums = lines[k].match(/(\d+\.\d+)/g);
               if (nums) collectedNumbers.push(...nums);
               const netLine = lines[k].match(/\bNet\b\s*[:\-\s]*([\d.]+)/i);
               if (netLine) foundNetExplicit = parseFloat(netLine[1]);
            }

            if (collectedNumbers.length >= 2) {
               const gross = parseFloat(collectedNumbers[0]);
               let net = foundNetExplicit ?? parseFloat(collectedNumbers[collectedNumbers.length - 1]);
               if (gross && net && net <= gross * 1.2 && net >= gross * 0.2) {
                  totalGross = gross;
                  totalNet = net;
               }
            } else if (collectedNumbers.length === 1 && foundNetExplicit) {
               totalNet = foundNetExplicit;
            }
         }
      }

      terminals.push({
         terminalId,
         date: reportDate, // التاريخ للترمينال ليتم فصل الإجماليات
         total: { gross: totalGross, net: totalNet },
         transactions,
      });
   });

   return terminals;
}

/* ======================
   دمج الترمينالات للإجماليات (بناءً على Terminal ID + Date)
   ====================== */
function mergeTerminals(terminals) {
   const map = {};

   terminals.forEach((item) => {
      const id = item.terminalId || item.terminal || "UNKNOWN";
      const dt = item.date || "غير محدد";
      const key = `${id}_${dt}`; // المفتاح المركب
      
      if (!map[key]) {
         map[key] = {
            terminalId: id,
            date: dt,
            transactions:[],
            total: { gross: 0, net: 0 },
         };
      }

      if (Array.isArray(item.transactions)) {
         map[key].transactions.push(...item.transactions);
      }

      if (item.total) {
         if (typeof item.total.gross === "number") map[key].total.gross += item.total.gross;
         if (typeof item.total.net === "number") map[key].total.net += item.total.net;
      }
   });

   return Object.values(map).sort((a, b) => a.date.localeCompare(b.date)); // ترتيب حسب التاريخ
}

/* ======================
   عرض جدول الإجماليات (يدعم عمود التاريخ)
   ====================== */
function renderTotalsTable(data) {
   const tbody = document.getElementById("totals-body");
   if (!tbody) return;
   tbody.innerHTML = "";

   data.forEach((item) => {
      const id = item.terminalId;
      const dt = item.date;
      const gross = item.total.gross != null ? item.total.gross.toFixed(3) : "-";
      const net = item.total.net != null ? item.total.net.toFixed(3) : "-";
      const diff = item.total.gross != null && item.total.net != null
            ? (item.total.gross - item.total.net).toFixed(3) : "-";

      const branch = branchInfo.find(
         (b) => String(b["Terminal ID"]).slice(-4) === String(id).slice(-4)
      ) || { name: "غير معروف", "account id": "-", "bank account": "-" };

      const trMain = document.createElement("tr");
      trMain.innerHTML = `
      <td style="font-weight:bold; color:#2980b9;">${dt}</td>
      <td>${branch.name}</td>
      <td>${id}</td>
      <td>${gross}</td>
      <td>${net}</td>
      <td><button class="toggle-btn">⬇️</button></td>`;

      const trDetails = document.createElement("tr");
      trDetails.classList.add("details-row");
      trDetails.style.display = "none";

      const detailsTable = `
      <table class="inner-table" border="1">
        <tr><th>Net</th><th>Fixed</th><th>Account</th></tr>
        <tr><td>${net}</td><td>0</td><td>${branch["bank account"]}</td></tr>
        <tr><td>${diff}</td><td>0</td><td>52121</td></tr>
        <tr><td>0</td><td>${gross}</td><td>${branch["account id"]}</td></tr>
      </table>`;

      const tdDetails = document.createElement("td");
      tdDetails.colSpan = 6;
      tdDetails.innerHTML = detailsTable;
      trDetails.appendChild(tdDetails);

      const btn = trMain.querySelector(".toggle-btn");
      btn.addEventListener("click", () => {
         const isOpen = trDetails.style.display === "table-row";
         trDetails.style.display = isOpen ? "none" : "table-row";
         btn.classList.toggle("rotate", !isOpen);
      });

      tbody.appendChild(trMain);
      tbody.appendChild(trDetails);
   });
}

/* تجهيز قائمة الترمينالات للمقارنة (تجميع بدون تكرار التواريخ) */
function populateTerminalSelect(data) {
   const select = document.getElementById("terminal-select");
   if (!select) return;
   
   const uniqueTerminals = new Set();
   data.forEach(item => uniqueTerminals.add(item.terminalId));

   const allOpt = document.createElement("option");
   allOpt.value = "ALL";
   allOpt.textContent = "الكل — (جميع الفروع)";
   select.appendChild(allOpt);

   Array.from(uniqueTerminals).forEach((id) => {
      const branch = branchInfo.find(
         (b) => String(b["Terminal ID"]).slice(-4) === String(id).slice(-4)
      ) || {};
      const text = branch.name ? `${branch.name} — (${id})` : id;
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = text;
      select.appendChild(opt);
   });
}

/* ======================
   قراءة الفواتير وتضمين التاريخ
   ====================== */
function parseInvoices(text, invoiceDate) {
   const lines = text.replace(/\r/g, "").split("\n").map((l) => l.trim());
   const invoices =[];
   const singleLineRegex = /^(\d{6,})\s+(.+?)\s+([\d.]+)\s*(?:[^\d\n]*?(?:رقم البطاقة|Card Number)\s*[:：]?\s*(\d{3,4}))?/i;

   for (let i = 0; i < lines.length; i++) {
      let L = lines[i].replace(/[\u200F\u200E\u202A\u202B\u202C\u202D\u202E]/g, "");
      let m = L.match(singleLineRegex);
      if (m) {
         const invId = m[1];
         const branchName = m[2] ? m[2].trim() : null;
         const amount = parseFloat(m[3]);
         let cardSearching = m[4] ? m[4] : null;

         if (!cardSearching) {
            for (let k = i + 1; k <= i + 3 && k < lines.length; k++) {
               const m2 = lines[k].match(/(?:رقم البطاقة|Card Number)\s*[:：]?\s*(\d{3,4})/i);
               if (m2) { cardSearching = m2[1]; break; }
            }
         }
         invoices.push({ invoiceId: invId, branchName, amount, cardNumber: cardSearching, date: invoiceDate });
         continue;
      }

      const alt = L.match(/^(\d{6,})\s+([\d.]+)\s*$/);
      if (alt) {
         const invId = alt[1];
         const amount = parseFloat(alt[2]);
         let cardFound = null;
         for (let k = i + 1; k <= i + 4 && k < lines.length; k++) {
            const m2 = lines[k].match(/(?:رقم البطاقة|Card Number)\s*[:：]?\s*(\d{3,4})/i);
            if (m2) { cardFound = m2[1]; break; }
         }
         invoices.push({ invoiceId: invId, branchName: null, amount, cardNumber: cardFound, date: invoiceDate });
      }
   }

   if (invoices.length === 0) {
      const allMatches = text.match(/(\d{6,})\s+([\d.]+)/g);
      if (allMatches) {
         allMatches.forEach((t) => {
            const parts = t.split(/\s+/);
            invoices.push({ invoiceId: parts[0], branchName: null, amount: parseFloat(parts[1]), cardNumber: null, date: invoiceDate });
         });
      }
   }
   return invoices;
}

/* ======================
   المقارنة (لا يوجد أي تعديل على المنطق الأساسي)
   ====================== */
function compareInvoicesToRecords(invoices, records, options) {
   const results =[];
   const usedInvoices = new Set();
   const usedRecords = new Set();

   if (options.showExact) {
      invoices.forEach((inv, i) => {
         const matchIdx = records.findIndex((r, j) =>
               !usedRecords.has(j) && r.cardNumber === inv.cardNumber && Math.abs(r.amount - inv.amount) < 0.001
         );
         if (matchIdx !== -1) {
            results.push({ type: "مطابقة تامة ✅", invoiceIndex: i, recordIndex: matchIdx, invoice: inv, record: records[matchIdx] });
            usedInvoices.add(i); usedRecords.add(matchIdx);
         }
      });
   }

   if (options.showCardOnly) {
      invoices.forEach((inv, i) => {
         if (usedInvoices.has(i)) return;
         const matchIdx = records.findIndex((r, j) => !usedRecords.has(j) && r.cardNumber === inv.cardNumber);
         if (matchIdx !== -1) {
            results.push({ type: "اختلاف في القيمة ⚠️", invoiceIndex: i, recordIndex: matchIdx, invoice: inv, record: records[matchIdx] });
            usedInvoices.add(i); usedRecords.add(matchIdx);
         }
      });
   }

   if (options.showAmountOnly) {
      invoices.forEach((inv, i) => {
         if (usedInvoices.has(i)) return;
         const matchIdx = records.findIndex((r, j) => !usedRecords.has(j) && Math.abs(r.amount - inv.amount) < 0.001);
         if (matchIdx !== -1) {
            results.push({ type: "اختلاف في رقم البطاقة ⚠️", invoiceIndex: i, recordIndex: matchIdx, invoice: inv, record: records[matchIdx] });
            usedInvoices.add(i); usedRecords.add(matchIdx);
         }
      });
   }

   if (options.showInvoiceOnly) {
      invoices.forEach((inv, i) => {
         if (usedInvoices.has(i)) return;
         results.push({ type: "فاتورة دون كشف ❌", invoiceIndex: i, recordIndex: null, invoice: inv, record: null });
      });
   }

   if (options.showRecordOnly) {
      records.forEach((r, j) => {
         if (usedRecords.has(j)) return;
         results.push({ type: "كشف دون فاتورة ⚠️", invoiceIndex: null, recordIndex: j, invoice: null, record: r });
      });
   }

   results.sort((a, b) => {
      const rank = { "مطابقة تامة ✅": 0, "اختلاف في القيمة ⚠️": 1, "اختلاف في رقم البطاقة ⚠️": 2, "فاتورة دون كشف ❌": 3, "كشف دون فاتورة ⚠️": 4 };
      return (rank[a.type] || 9) - (rank[b.type] || 9);
   });

   return results;
}

/* ======================
   زر المقارنة (تجميع ومقارنة وفلترة بصرية)
   ====================== */
document.getElementById("compare-btn")?.addEventListener("click", () => {
   console.groupCollapsed("🔵 [ACTION] Compare Button Clicked");

   if (!merged.length) {
      alert("الرجاء تحليل تقرير البنك أولاً.");
      console.warn("⚠️ [WARN] Tried to compare but no merged terminals exist.");
      console.groupEnd();
      return;
   }

   const terminalId = document.getElementById("terminal-select")?.value;
   let allInvoices =[];

   for (let i = 1; i <= 10; i++) {
      const textEl = document.getElementById(`invoice-text-${i}`);
      const dateEl = document.getElementById(`invoice-date-${i}`);
      if (textEl && dateEl && textEl.value.trim() !== "") {
         if (!dateEl.value) {
            alert(`الرجاء إدخال التاريخ للفواتير رقم ${i}`);
            console.warn(`⚠️ [WARN] Missing date for invoice input ${i}`);
            console.groupEnd();
            return;
         }
         console.log(`⏳ [PARSING] Invoices for Date: ${dateEl.value}`);
         const invs = parseInvoices(textEl.value, dateEl.value);
         allInvoices.push(...invs);
      }
   }

   let allRecords =[];
   if (terminalId === "ALL") {
      merged.forEach((t) => allRecords.push(...t.transactions));
   } else {
      const terms = merged.filter((t) => String(t.terminalId) === String(terminalId));
      if (!terms.length) { 
         alert("لا يوجد سجلات لهذا التيرمينال"); 
         console.warn(`⚠️ [WARN] Terminal ${terminalId} not found in records.`);
         console.groupEnd();
         return; 
      }
      terms.forEach(t => allRecords.push(...t.transactions));
   }

   console.log("📊 [COMPARE DATA] Total Invoices to Compare:", allInvoices.length);
   console.log("📊 [COMPARE DATA] Total Records to Compare against:", allRecords.length);

   // المنطق هنا دائماً يقارن كل شيء لعدم تخريب الدالة
   const alwaysTrueOptions = {
      showExact: true, showCardOnly: true, showAmountOnly: true,
      showInvoiceOnly: true, showRecordOnly: true
   };

   const uniqueDates = new Set();
   allInvoices.forEach(inv => { if (inv.date) uniqueDates.add(inv.date); });
   allRecords.forEach(rec => { if (rec.date) uniqueDates.add(rec.date); });

   let finalResults =[];

   uniqueDates.forEach(date => {
      const dayInvoices = allInvoices.filter(inv => inv.date === date);
      const dayRecords = allRecords.filter(rec => rec.date === date);

      console.log(`🔄[COMPARING] For Date ${date} -> Invoices: ${dayInvoices.length}, Records: ${dayRecords.length}`);
      const dayResults = compareInvoicesToRecords(dayInvoices, dayRecords, alwaysTrueOptions);
      
      dayResults.forEach(r => {
         r.compareDate = date;
         finalResults.push(r);
      });
   });

   console.log("✅ [COMPARE RESULTS] Final merged comparison results:", finalResults);
   renderCompareResults(finalResults);
   
   // تفعيل الفلاتر البصرية بعد الرندر
   applyVisualFilters();

   console.groupEnd();
});

/* ======================
   الفلاتر البصرية (إخفاء وإظهار الأسطر في الجدول)
   ====================== */
function applyVisualFilters() {
   const exactChecked = document.getElementById("showExact")?.checked;
   const cardChecked = document.getElementById("showCardOnly")?.checked;
   const amountChecked = document.getElementById("showAmountOnly")?.checked;
   const invoiceChecked = document.getElementById("showInvoiceOnly")?.checked;
   const recordChecked = document.getElementById("showRecordOnly")?.checked;

   document.querySelectorAll('tr[data-type="exact"]').forEach(el => el.style.display = exactChecked ? "" : "none");
   document.querySelectorAll('tr[data-type="card-diff"]').forEach(el => el.style.display = cardChecked ? "" : "none");
   document.querySelectorAll('tr[data-type="amount-diff"]').forEach(el => el.style.display = amountChecked ? "" : "none");
   document.querySelectorAll('tr[data-type="invoice-only"]').forEach(el => el.style.display = invoiceChecked ? "" : "none");
   document.querySelectorAll('tr[data-type="record-only"]').forEach(el => el.style.display = recordChecked ? "" : "none");
}

// إضافة مراقب (Listener) للتشيك بوكس لتعمل مباشرة فور النقر['showExact', 'showCardOnly', 'showAmountOnly', 'showInvoiceOnly', 'showRecordOnly'].forEach(id => {
   document.getElementById(id)?.addEventListener('change', applyVisualFilters);


/* ======================
   تخزين الأخطاء وعرض النتائج
   ====================== */
function loadErrors() {
    try { return JSON.parse(localStorage.getItem("visaErrors") || "[]"); } 
    catch { return[]; }
}
function saveErrors(list) {
    localStorage.setItem("visaErrors", JSON.stringify(list));
}

function renderCompareResults(results) {
   const container = document.getElementById("compare-results");
   if (!container) return;
   container.innerHTML = ""; 

   if (results.length === 0) {
      container.innerHTML = "<h3>لا توجد نتائج للمقارنة</h3>";
      return;
   }

   const currentErrors = loadErrors();
   const dateGroups = {};
   
   results.forEach(r => {
      const d = r.compareDate || "غير محدد";
      if (!dateGroups[d]) dateGroups[d] = [];
      dateGroups[d].push(r);
   });

   const sortedDates = Object.keys(dateGroups).sort((a, b) => a.localeCompare(b));

   sortedDates.forEach(date => {
      const dateWrapper = document.createElement("div");
      dateWrapper.className = "date-section-container";
      dateWrapper.style.marginBottom = "50px";

      const dateHeader = document.createElement("h2");
      dateHeader.className = "date-section-header";
      dateHeader.textContent = `📅 مقـارنـات يـوم: ${date}`;
      dateWrapper.appendChild(dateHeader);

      const dateResults = dateGroups[date];
      const groups = {};
      const unknownKey = "UNMATCHED_INVOICES"; 

      dateResults.forEach((r) => {
         let key = unknownKey;
         if (r.record && r.record.terminal) {
            key = r.record.terminal;
         } else if (r.invoice && r.invoice.branchName) {
            const foundBranch = branchInfo.find(b => 
               b.name && r.invoice.branchName && 
               b.name.trim() === r.invoice.branchName.trim()
            );
            if (foundBranch && foundBranch["Terminal ID"]) {
               key = foundBranch["Terminal ID"];
            }
         }
         if (!groups[key]) groups[key] = [];
         groups[key].push(r);
      });

      const keys = Object.keys(groups).sort((a, b) => {
          if (a === unknownKey) return 1;
          if (b === unknownKey) return -1;
          return a.localeCompare(b);
      });

      keys.forEach((termId) => {
         const groupResults = groups[termId];
         const branch = branchInfo.find(b => String(b["Terminal ID"]).slice(-4) === String(termId).slice(-4));
         const branchName = branch ? branch.name : (termId === unknownKey ? "غير معروف" : "فرع غير معروف");
         const accountId = branch ? branch["account id"] : "";

         let titleText = termId === unknownKey 
             ? `⚠️ عمليات غير معروفة الفرع (${groupResults.length})` 
             : `🏢 ${branchName} - (Terminal: ${termId}) - العدد: ${groupResults.length}`;

         const section = document.createElement("div");
         section.className = "terminal-section";
         section.style.marginBottom = "25px";
         
         const header = document.createElement("h3");
         header.style.backgroundColor = termId === unknownKey ? "#e74c3c" : "#2c3e50";
         header.style.color = "#fff";
         header.style.padding = "10px";
         header.textContent = titleText;
         section.appendChild(header);

         const tableHTML = `
           <table class="results-table" style="width:100%; border-collapse: collapse;">
               <thead>
                   <tr style="background-color: #f2f2f2;">
                       <th>التاريخ</th>
                       <th>النوع</th>
                       <th>رقم الفاتورة</th>
                       <th>رقم البطاقة</th>
                       <th>قيمة الفاتورة</th>
                       <th>قيمة السجل</th>
                       <th>إجراءات</th>
                   </tr>
               </thead>
               <tbody>
                   ${groupResults.map((r) => {
                       let rowColor = r.type.includes("مطابقة") ? "#e8f5e9" : (r.type.includes("غير موجودة") || r.type.includes("دون") ? "#ffebee" : "#fff3e0");
                       
                       // استخراج نوع السطر من أجل فلتر الإخفاء البصري
                       let rowDataType = "";
                       if (r.type.includes("تامة")) rowDataType = "exact";
                       else if (r.type.includes("القيمة")) rowDataType = "card-diff";
                       else if (r.type.includes("رقم البطاقة")) rowDataType = "amount-diff";
                       else if (r.type.includes("فاتورة دون")) rowDataType = "invoice-only";
                       else if (r.type.includes("كشف دون")) rowDataType = "record-only";

                       const invDate = r.compareDate;
                       const invId = r.invoice?.invoiceId || "-";
                       const cardNum = r.invoice?.cardNumber || r.record?.cardNumber || "-";
                       const invAmt = r.invoice?.amount || 0;
                       const recAmt = r.record?.amount || 0;
                       const bName = branchName; 
                       const bAcc = accountId;

                       const isAlreadySaved = currentErrors.some(e => e.invoiceId === invId && e.cardNumber === cardNum && e.date === invDate);

                       let btnHTML = "";
                       if (!r.type.includes("مطابقة")) {
                           if (isAlreadySaved) {
                                btnHTML = `<button disabled style="background:#95a5a6; color:white; border:none; padding:5px 10px; border-radius:3px; cursor:not-allowed;">تم الترحيل ✅</button>`;
                           } else {
                                btnHTML = `
                                   <button onclick='addErrorFromRow(event, this, "${invId}", "${cardNum}", ${invAmt}, ${recAmt}, "${bName}", "${bAcc}", "${invDate}")' 
                                           style="background:#e67e22; color:white; border:none; padding:5px 10px; cursor:pointer; border-radius:3px;">
                                       ترحيل للأخطاء
                                   </button>
                                `;
                           }
                       } else {
                           btnHTML = `<span style="color:green; font-weight:bold;">✅</span>`;
                       }

                       // إضافة onClick للسطر كاملاً لتطبيق الشطب، مع استثناء زر الترحيل
                       return `
                       <tr data-type="${rowDataType}" style="background-color: ${rowColor};" onclick="this.classList.toggle('strikethrough')">
                           <td style="font-weight:bold;">${invDate}</td>
                           <td>${r.type}</td>
                           <td>${invId}</td>
                           <td>${cardNum}</td>
                           <td>${invAmt}</td>
                           <td>${recAmt}</td>
                           <td style="text-align:center;" onclick="event.stopPropagation();">${btnHTML}</td>
                       </tr>
                       `;
                   }).join("")}
               </tbody>
           </table>
         `;

         section.innerHTML += tableHTML;
         dateWrapper.appendChild(section);
      });

      container.appendChild(dateWrapper);
   });
}

// دالة الترحيل المحدثة لمنع الشطب عند الضغط على الزر (عبر استلام event)
window.addErrorFromRow = function(event, btnElement, invId, cardNum, invAmt, recAmt, bName, bAcc, errDate) {
    event.stopPropagation(); // يمنع النقر من الانتقال للسطر وتطبيق الشطب

    const list = loadErrors();
    const exists = list.find(e => e.invoiceId === invId && e.cardNumber === cardNum && e.date === errDate);
    
    if (exists) {
        alert("هذا الخطأ مسجل بالفعل في هذا التاريخ!");
        btnElement.innerText = "تم الترحيل ✅";
        btnElement.style.background = "#95a5a6";
        btnElement.style.cursor = "not-allowed";
        btnElement.disabled = true;
        return;
    }

    list.push({
        date: errDate, 
        invoiceId: invId,
        cardNumber: cardNum,
        invoiceValue: invAmt,
        reportValue: recAmt,
        branchName: bName,
        branchAccountId: bAcc,
        errorType: 0
    });
    saveErrors(list);

    console.log("💾[SAVE] Error saved to LocalStorage:", { invId, cardNum, errDate });

    btnElement.innerText = "تم الترحيل ✅";
    btnElement.style.background = "#95a5a6";
    btnElement.style.cursor = "not-allowed";
    btnElement.disabled = true;
};
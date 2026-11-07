/*
 * AVL Shop - front end.
 * All data lives in the C++ engine (shop.wasm). This file only calls the
 * engine's functions, which return JSON strings, and draws the results.
 */
(function () {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const SVG_NS = "http://www.w3.org/2000/svg";

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  const MODES = {
    prefix:   { hint: "Finds names that begin with your text. Uses a range query on the name tree.", big: "O(log n + k)", order: "name order" },
    contains: { hint: "Finds your text anywhere in the name. A tree cannot skip anything here, so every product is checked.", big: "O(n)", order: "name order" },
    price:    { hint: "Finds products between two prices. Leave one side empty for no limit.", big: "O(log n + k)", order: "price order" },
    id:       { hint: "Finds one product by its ID using the ID tree.", big: "O(log n)", order: "" },
  };

  const state = {
    shop: null,
    mode: "prefix",
    sort: "id",
    desc: false,
    tab: "shelf",
    tree: "id",
    flashId: null,
    lastHitIds: new Set(),
  };

  // ---------------------------------------------------------------- engine
  function call(name, ...args) {
    return JSON.parse(state.shop[name](...args));
  }

  function showBanner(html) {
    const b = $("#banner");
    b.innerHTML = html;
    b.hidden = false;
  }

  let statusTimer = null;
  function setStatus(msg, ok) {
    const s = $("#status");
    clearTimeout(statusTimer);
    s.textContent = msg || "";
    s.className = "status" + (msg ? (ok ? " ok" : " err") : "");
    if (msg) statusTimer = setTimeout(() => setStatus(""), 7000);
  }

  // ---------------------------------------------------------------- formatting
  function splitPrice(p) {
    const [whole, paise] = Number(p).toFixed(2).split(".");
    return { whole: Number(whole).toLocaleString("en-IN"), paise };
  }

  // ---------------------------------------------------------------- shelf
  function readQuery() {
    // Returns { items, summary, big, searching } for the current search box state.
    const mode = state.mode;
    if (mode === "prefix" || mode === "contains") {
      const q = $("#q").value.trim();
      if (!q) return null;
      const res = call(mode === "prefix" ? "searchPrefix" : "searchContains", q);
      const verb = mode === "prefix" ? "start with" : "contain";
      return { res, text: `${plural(res.count, "product")} ${verb} "${q}"`, mode };
    }
    if (mode === "price") {
      const a = $("#pmin").value.trim();
      const b = $("#pmax").value.trim();
      if (!a && !b) return null;
      const lo = a === "" ? 0 : Number(a);
      const hi = b === "" ? 1e12 : Number(b);
      if (Number.isNaN(lo) || Number.isNaN(hi) || lo < 0 || hi < 0) {
        return { error: "Prices must be 0 or more." };
      }
      const res = call("searchPrice", lo, hi);
      let range;
      if (a === "") range = `up to Rs ${b}`;
      else if (b === "") range = `from Rs ${a}`;
      else range = `between Rs ${Math.min(lo, hi)} and Rs ${Math.max(lo, hi)}`;
      return { res, text: `${plural(res.count, "product")} ${range}`, mode };
    }
    // id
    const v = $("#qid").value.trim();
    if (!v) return null;
    if (!/^\d+$/.test(v)) return { error: "Enter the ID as a whole number." };
    const res = call("searchById", parseInt(v, 10));
    return { res, text: res.count ? `Product ${v}` : `No product has ID ${v}`, mode };
  }

  function plural(n, word) {
    return `${n} ${word}${n === 1 ? "" : "s"}`;
  }

  function renderShelf() {
    const shelf = $("#shelf");
    const empty = $("#empty");
    const summary = $("#summary");
    const sortBox = $("#sort-box");
    shelf.replaceChildren();
    empty.hidden = true;

    const stats = call("stats");
    let q = readQuery();
    let items, searching = false;

    if (q && q.error) {
      summary.textContent = q.error;
      sortBox.hidden = true;
      state.lastHitIds = new Set();
      return;
    }

    if (q) {
      searching = true;
      items = q.res.items;
      summary.textContent = q.text;
      const big = el("span", "bigo", MODES[q.mode].big);
      big.title = "Time complexity of this search";
      summary.append(big);
      const ord = MODES[q.mode].order;
      if (ord && items.length > 1) summary.append(document.createTextNode(`, in ${ord}`));
      state.lastHitIds = new Set(items.map((p) => p.id));
    } else {
      const res = call("listSorted", state.sort, state.desc);
      items = res.items;
      const by = { id: "ID", name: "name", price: "price" }[state.sort];
      summary.textContent = `${plural(res.count, "product")}, sorted by ${by}`;
      const big = el("span", "bigo", "O(n)");
      big.title = "Time complexity of listing every product in order";
      summary.append(big);
      state.lastHitIds = new Set();
    }
    sortBox.hidden = searching;

    if (stats.size === 0) {
      showEmpty(
        "The shelf is empty",
        "Load the 15 sample products, or add your own from the form on the left.",
        true
      );
      return;
    }
    if (items.length === 0) {
      const tip = {
        prefix: "Try fewer letters, or switch to Name contains.",
        contains: "Check the spelling, or try fewer letters.",
        price: "Widen the price range.",
        id: "Check the ID, or sort the shelf by ID to see which IDs exist.",
      }[state.mode];
      showEmpty("Nothing matches", tip, false);
      return;
    }

    const frag = document.createDocumentFragment();
    for (const p of items) frag.append(makeTag(p));
    shelf.append(frag);

    if (state.flashId !== null) {
      const hit = shelf.querySelector(`[data-id="${state.flashId}"]`);
      if (hit) {
        hit.classList.add("flash");
        hit.scrollIntoView({ block: "nearest" });
      }
      state.flashId = null;
    }
  }

  function showEmpty(title, text, withSample) {
    const e = $("#empty");
    e.replaceChildren(el("h2", null, title), el("p", null, text));
    if (withSample) {
      const b = el("button", "btn-primary", "Load 15 sample products");
      b.type = "button";
      b.addEventListener("click", () => {
        const r = call("loadSample");
        setStatus(r.msg, r.ok);
        refresh();
      });
      e.append(b);
    }
    e.hidden = false;
  }

  function makeTag(p) {
    const li = el("li", "tag");
    li.dataset.id = p.id;

    const name = el("h3", "tag-name", p.name);
    name.title = p.name;

    const { whole, paise } = splitPrice(p.price);
    const priceBox = el("p", whole.length > 5 ? "price long" : "price");
    priceBox.append(el("span", "rs", "Rs"), document.createTextNode(whole), el("span", "paise", paise));
    priceBox.setAttribute("aria-label", `Price: Rs ${whole}.${paise}`);

    const meta = el("p", "tag-meta");
    meta.append(el("span", null, `ID ${p.id}`));
    const stock = el("span", p.stock < 15 ? "low" : "", p.stock === 0 ? "Out of stock" : p.stock < 15 ? `Only ${p.stock} left` : `${p.stock} in stock`);
    meta.append(stock);

    const actions = el("div", "tag-actions");
    const edit = el("button", null, "Edit");
    edit.type = "button";
    edit.setAttribute("aria-label", `Edit price and stock of ${p.name}`);
    edit.addEventListener("click", () => startEdit(p, [priceBox, meta, actions]));

    const remove = el("button", "remove", "Remove");
    remove.type = "button";
    remove.setAttribute("aria-label", `Remove ${p.name}`);
    let armed = null;
    const disarm = () => {
      remove.textContent = "Remove";
      remove.setAttribute("aria-label", `Remove ${p.name}`);
      armed = null;
    };
    remove.addEventListener("click", () => {
      if (!armed) {
        remove.textContent = "Confirm remove";
        remove.setAttribute("aria-label", `Confirm removing ${p.name}`);
        armed = setTimeout(disarm, 3000);
        return;
      }
      clearTimeout(armed);
      const r = call("removeProduct", p.id);
      setStatus(r.msg, r.ok);
      refresh();
    });

    actions.append(edit, remove);
    li.append(name, priceBox, meta, actions);
    return li;
  }

  function startEdit(p, hideList) {
    const priceBox = hideList[0];
    const form = el("form", "price-edit");
    form.noValidate = true;

    const field = (labelText, value, step, mode) => {
      const label = el("label");
      label.append(el("span", null, labelText));
      const input = document.createElement("input");
      input.type = "number";
      input.min = "0";
      input.step = step;
      input.value = value;
      input.inputMode = mode;
      label.append(input);
      return { label, input };
    };
    const priceF = field("Price (Rs)", p.price, "any", "decimal");
    const stockF = field("Stock", p.stock, "1", "numeric");
    const row = el("div", "pe-row");
    row.append(priceF.label, stockF.label);

    const save = el("button", null, "Save");
    save.type = "submit";
    const cancel = el("button", null, "Cancel");
    cancel.type = "button";
    const btns = el("div", "pe-btns");
    btns.append(save, cancel);
    form.append(row, btns);

    for (const n of hideList) n.hidden = true;
    priceBox.before(form);
    priceF.input.focus();
    priceF.input.select();

    const close = () => { form.remove(); for (const n of hideList) n.hidden = false; };
    cancel.addEventListener("click", close);
    form.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const pv = priceF.input.value.trim();
      const sv = stockF.input.value.trim();
      if (pv === "" || Number.isNaN(Number(pv)) || Number(pv) < 0) {
        setStatus("Enter a price of 0 or more.", false);
        priceF.input.focus();
        return;
      }
      if (!/^\d+$/.test(sv)) {
        setStatus("Enter the stock as a whole number of 0 or more.", false);
        stockF.input.focus();
        return;
      }
      const msgs = [];
      let ok = true;
      if (Number(pv) !== p.price) {
        const r = call("updatePrice", p.id, Number(pv));
        ok = ok && r.ok; msgs.push(r.msg);
      }
      if (parseInt(sv, 10) !== p.stock) {
        const r = call("updateStock", p.id, parseInt(sv, 10));
        ok = ok && r.ok; msgs.push(r.msg);
      }
      setStatus(msgs.length ? msgs.join(" ") : "Nothing changed.", ok);
      if (ok && msgs.length) state.flashId = p.id;
      refresh();
    });
  }

  // ---------------------------------------------------------------- stats + tree
  function renderStats() {
    const s = call("stats");
    $("#st-size").textContent = s.size;
    $("#st-hid").textContent = s.hId;
    $("#st-hname").textContent = s.hName;
    $("#st-hprice").textContent = s.hPrice;
    const best = s.size ? Math.ceil(Math.log2(s.size + 1)) : 0;
    const worst = s.size ? (1.44 * Math.log2(s.size + 2)).toFixed(1) : "0";
    $("#tree-summary").textContent =
      s.size === 0
        ? "No products yet, so there is nothing to draw."
        : `${plural(s.size, "product")}. The tallest an AVL tree of this size can be is about ${worst}; the shortest possible is ${best}.`;
    return s;
  }

  function svg(tag, attrs) {
    const n = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  function renderTree() {
    const box = $("#tree");
    box.replaceChildren();
    const root = call("treeJson", state.tree);
    if (!root) {
      box.append(el("p", "hint", "The tree is empty. Add a product or load the sample data."));
      return;
    }

    // In-order layout: x = position in sorted order, y = depth.
    const nodes = [];
    let idx = 0, maxDepth = 0, maxLabel = 3;
    (function walk(n, d) {
      if (!n) return null;
      const node = { data: n, d, left: null, right: null, x: 0 };
      maxDepth = Math.max(maxDepth, d);
      if (n.cut) { node.x = idx++; nodes.push(node); return node; }
      maxLabel = Math.max(maxLabel, Math.min(n.key.length, 16));
      node.left = walk(n.l, d + 1);
      node.x = idx++;
      node.right = walk(n.r, d + 1);
      nodes.push(node);
      return node;
    })(root, 0);

    const nodeW = Math.max(44, maxLabel * 7.4 + 20);
    const unit = nodeW + 10;
    const rowH = 84, nodeH = 30, pad = 20;
    const width = idx * unit + pad * 2;
    const height = (maxDepth + 1) * rowH + pad;
    const X = (n) => pad + n.x * unit + unit / 2;
    const Y = (n) => pad + n.d * rowH;

    const s = svg("svg", { width, height, viewBox: `0 0 ${width} ${height}`, role: "img",
      "aria-label": `AVL tree ordered by ${state.tree}` });

    const edges = svg("g", {});
    const body = svg("g", {});
    for (const n of nodes) {
      for (const c of [n.left, n.right]) {
        if (!c) continue;
        const x1 = X(n), y1 = Y(n) + nodeH + 4, x2 = X(c), y2 = Y(c);
        const mid = (y1 + y2) / 2;
        edges.append(svg("path", { class: "edge", d: `M${x1},${y1} C${x1},${mid} ${x2},${mid} ${x2},${y2}` }));
      }

      const d = n.data;
      const g = svg("g", { class: "node" + (d.cut ? " cut" : "") + (!d.cut && state.lastHitIds.has(d.id) ? " hit" : "") });
      const w = d.cut ? 34 : nodeW;
      g.append(svg("rect", { x: X(n) - w / 2, y: Y(n), width: w, height: nodeH, rx: 15 }));
      const label = d.cut ? "..." : d.key.length > 16 ? d.key.slice(0, 15) + "~" : d.key;
      const t = svg("text", { x: X(n), y: Y(n) + nodeH / 2 + 1 });
      t.textContent = label;
      g.append(t);
      const title = svg("title", {});
      title.textContent = d.cut ? "Deeper levels are not drawn" : `${d.key} (product ${d.id}), height ${d.h}, balance factor ${d.bf}`;
      g.append(title);
      if (!d.cut) {
        const bf = svg("text", { class: "bf", x: X(n), y: Y(n) + nodeH + 14 });
        bf.textContent = `bf ${d.bf > 0 ? "+" + d.bf : d.bf}`;
        g.append(bf);
      }
      body.append(g);
    }
    s.append(edges, body);
    box.append(s);
  }

  // ---------------------------------------------------------------- balance demo
  function runBalance() {
    let n = parseInt($("#bal-n").value, 10);
    if (!Number.isFinite(n) || n < 1) n = 1;
    if (n > 100000) n = 100000;
    $("#bal-n").value = n;
    const r = call("balanceDemo", n);
    const out = $("#balance-out");
    out.replaceChildren();

    const row = (cls, what, num, pct, extra) => {
      const d = el("div", "bar-row");
      const p = el("p");
      p.append(el("span", "what", what), el("span", "num", num));
      const track = el("div", "track");
      const fill = el("div", "fill " + cls);
      fill.style.width = pct + "%";
      track.append(fill);
      d.append(p, track);
      if (extra) d.append(el("p", "note", extra));
      return d;
    };

    const nf = (x) => x.toLocaleString("en-IN");
    out.append(
      row("bst", "Plain BST, no balancing: height", nf(r.bstHeight), 100,
        "Sorted input makes every product the right child of the last one. That is a linked list, so a search checks up to " + nf(r.bstHeight) + " products."),
      row("avl", "AVL tree: height", nf(r.avlHeight), Math.max(0.3, (r.avlHeight / r.bstHeight) * 100),
        "Rotations keep the tree balanced, so a search checks at most " + nf(r.avlHeight) + " products. The proven limit for " + nf(r.n) + " products is about " + r.bound + " (1.44 x log2(n + 2)).")
    );
  }

  // ---------------------------------------------------------------- wiring
  function refresh() {
    renderStats();
    renderShelf();
    if (state.tab === "tree") renderTree();
    updateAddPlaceholder();
  }

  function updateAddPlaceholder() {
    const res = call("listSorted", "id", true);
    const max = res.items.length ? res.items[0].id : 100;
    $("#a-id").placeholder = String(max + 1);
  }

  function setMode(mode) {
    state.mode = mode;
    for (const b of document.querySelectorAll(".modes button")) {
      b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
    }
    $("#f-text").hidden = !(mode === "prefix" || mode === "contains");
    $("#f-price").hidden = mode !== "price";
    $("#f-id").hidden = mode !== "id";
    $("#mode-hint").textContent = MODES[mode].hint + " Speed: " + MODES[mode].big + ".";
    $("#q").placeholder = mode === "prefix" ? "wire" : "mouse";
    renderShelf();
    if (state.tab === "tree") renderTree();
  }

  function setTab(name) {
    state.tab = name;
    for (const t of ["shelf", "tree", "balance"]) {
      const on = t === name;
      const tab = $("#tab-" + t);
      tab.setAttribute("aria-selected", String(on));
      tab.tabIndex = on ? 0 : -1;
      $("#panel-" + t).hidden = !on;
    }
    if (name === "tree") renderTree();
    if (name === "balance" && !$("#balance-out").children.length) runBalance();
  }

  function clearSearch() {
    for (const id of ["q", "pmin", "pmax", "qid"]) $("#" + id).value = "";
    renderShelf();
    if (state.tab === "tree") renderTree();
  }

  function dirLabel() {
    const names = { id: ["Low to high", "High to low"], name: ["A to Z", "Z to A"], price: ["Low to high", "High to low"] }[state.sort];
    const b = $("#dir");
    b.textContent = state.desc ? names[1] : names[0];
    b.setAttribute("aria-label", `Order: ${state.desc ? "descending" : "ascending"}. Click to reverse.`);
  }

  function onSearchInput() {
    setStatus("");
    renderShelf();
    if (state.tab === "tree") renderTree();
  }

  function init() {
    // search
    for (const b of document.querySelectorAll(".modes button")) {
      b.addEventListener("click", () => setMode(b.dataset.mode));
    }
    for (const id of ["q", "pmin", "pmax", "qid"]) $("#" + id).addEventListener("input", onSearchInput);
    $("#find-form").addEventListener("submit", (e) => e.preventDefault());
    $("#clear").addEventListener("click", clearSearch);

    // sorting
    $("#sort").addEventListener("change", (e) => { state.sort = e.target.value; dirLabel(); renderShelf(); });
    $("#dir").addEventListener("click", () => { state.desc = !state.desc; dirLabel(); renderShelf(); });
    dirLabel();

    // add
    $("#add-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const idv = $("#a-id").value.trim();
      const name = $("#a-name").value.trim();
      const pv = $("#a-price").value.trim();
      const sv = $("#a-stock").value.trim();
      if (!/^\d+$/.test(idv) || Number(idv) < 1) return fail("Enter an ID that is a whole number of 1 or more.", "#a-id");
      if (!name) return fail("Enter a product name.", "#a-name");
      if (pv === "" || Number.isNaN(Number(pv)) || Number(pv) < 0) return fail("Enter a price of 0 or more.", "#a-price");
      if (!/^\d+$/.test(sv)) return fail("Enter the stock as a whole number of 0 or more.", "#a-stock");
      const r = call("addProduct", parseInt(idv, 10), name, Number(pv), parseInt(sv, 10));
      setStatus(r.msg, r.ok);
      if (!r.ok) { $("#a-id").focus(); return; }
      state.flashId = parseInt(idv, 10);
      $("#a-id").value = ""; $("#a-name").value = ""; $("#a-price").value = "";
      clearSearchBoxesOnly();
      refresh();
      $("#a-id").focus();
    });

    // tabs
    for (const t of ["shelf", "tree", "balance"]) {
      $("#tab-" + t).addEventListener("click", () => setTab(t));
    }
    $(".tabs").addEventListener("keydown", (e) => {
      const order = ["shelf", "tree", "balance"];
      const i = order.indexOf(state.tab);
      let j = null;
      if (e.key === "ArrowRight") j = (i + 1) % order.length;
      if (e.key === "ArrowLeft") j = (i + order.length - 1) % order.length;
      if (j === null) return;
      e.preventDefault();
      setTab(order[j]);
      $("#tab-" + order[j]).focus();
    });

    // tree + balance
    $("#tree-pick").addEventListener("change", (e) => { state.tree = e.target.value; renderTree(); });
    $("#balance-form").addEventListener("submit", (e) => { e.preventDefault(); runBalance(); });
    for (const b of document.querySelectorAll(".presets button")) {
      b.addEventListener("click", () => { $("#bal-n").value = b.dataset.n; runBalance(); });
    }

    setMode("prefix");
    refresh();
  }

  function clearSearchBoxesOnly() {
    for (const id of ["q", "pmin", "pmax", "qid"]) $("#" + id).value = "";
  }

  function fail(msg, focusSel) {
    setStatus(msg, false);
    $(focusSel).focus();
  }

  // ---------------------------------------------------------------- start
  if (typeof createShop !== "function") {
    showBanner(
      "<strong>The C++ engine was not found.</strong> This page needs <code>shop.js</code> and <code>shop.wasm</code> " +
      "in the same folder as <code>index.html</code>. Run <code>build.sh</code> (or <code>build.bat</code> on Windows) to create them."
    );
    return;
  }

  createShop().then((module) => {
    state.shop = module;
    init();
  }).catch((err) => {
    showBanner("<strong>The C++ engine failed to start.</strong> Open this page through a web server (the Netlify link or <code>python -m http.server</code>), not by double-clicking the file.");
    console.error(err);
  });
})();

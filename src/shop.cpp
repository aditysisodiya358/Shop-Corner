/*
 * Online Shopping Product Search  --  ADSA Mini Project (web version)
 * Data structure : AVL Tree (self-balancing BST)
 *
 * The AVLTree and Store classes are the same as the console version.
 * Only the menu / cin / cout part was replaced by a small API that returns
 * JSON strings, so the browser (app.js) can draw the interface.
 *
 *   byId    : key = id                     -> search by ID
 *   byName  : key = (lowercase name, id)   -> search / sort by name
 *   byPrice : key = (price, id)            -> search / sort by price
 *
 * Build for the web (Emscripten):  see build.sh / build.bat
 * Quick native test             :  g++ -std=c++17 -DSHOP_NATIVE_TEST src/shop.cpp -o shop_test
 */
#include <algorithm>
#include <cctype>
#include <climits>
#include <cmath>
#include <cstdio>
#include <functional>
#include <memory>
#include <string>
#include <utility>

using namespace std;

struct Product {
    int id;
    string name;
    double price;
    int stock;
};
using ProductPtr = shared_ptr<Product>;

// ---------------------------------------------------------------- JSON helpers
static string jstr(const string& s) {
    string o = "\"";
    for (unsigned char c : s) {
        switch (c) {
        case '"':  o += "\\\""; break;
        case '\\': o += "\\\\"; break;
        case '\n': o += "\\n";  break;
        case '\r': o += "\\r";  break;
        case '\t': o += "\\t";  break;
        default:
            if (c < 0x20) { char b[8]; snprintf(b, sizeof b, "\\u%04x", c); o += b; }
            else o += (char)c;
        }
    }
    return o + "\"";
}
static string money(double v) {
    char b[64];
    snprintf(b, sizeof b, "%.2f", v);
    return b;
}

// ---------------------------------------------------------------- AVL Tree
template <typename Key>
class AVLTree {
    struct Node {
        Key key;
        ProductPtr val;
        Node *left = nullptr, *right = nullptr;
        int height = 1;
        Node(const Key& k, ProductPtr v) : key(k), val(std::move(v)) {}
    };

    Node* root = nullptr;
    size_t count = 0;

    static int h(Node* n) { return n ? n->height : 0; }
    static void update(Node* n) { n->height = 1 + max(h(n->left), h(n->right)); }
    static int balance(Node* n) { return n ? h(n->left) - h(n->right) : 0; }

    static Node* rotateRight(Node* y) {
        Node* x = y->left;
        y->left = x->right;
        x->right = y;
        update(y);
        update(x);
        return x;
    }
    static Node* rotateLeft(Node* x) {
        Node* y = x->right;
        x->right = y->left;
        y->left = x;
        update(x);
        update(y);
        return y;
    }
    static Node* rebalance(Node* n) {
        update(n);
        int b = balance(n);
        if (b > 1) {                                   // left heavy
            if (balance(n->left) < 0) n->left = rotateLeft(n->left);   // LR
            return rotateRight(n);                                      // LL
        }
        if (b < -1) {                                  // right heavy
            if (balance(n->right) > 0) n->right = rotateRight(n->right); // RL
            return rotateLeft(n);                                        // RR
        }
        return n;
    }

    Node* insert(Node* n, const Key& k, const ProductPtr& v, bool& ok) {
        if (!n) { ok = true; return new Node(k, v); }
        if (k < n->key)      n->left  = insert(n->left, k, v, ok);
        else if (n->key < k) n->right = insert(n->right, k, v, ok);
        else { ok = false; return n; }                 // duplicate key
        return rebalance(n);
    }

    Node* erase(Node* n, const Key& k, bool& ok) {
        if (!n) return nullptr;
        if (k < n->key)      n->left  = erase(n->left, k, ok);
        else if (n->key < k) n->right = erase(n->right, k, ok);
        else {
            ok = true;
            if (!n->left || !n->right) {               // 0 or 1 child
                Node* child = n->left ? n->left : n->right;
                delete n;
                return child;
            }
            Node* s = n->right;                        // two children:
            while (s->left) s = s->left;               // inorder successor
            Key succKey = s->key;
            n->key = succKey;
            n->val = s->val;
            bool dummy;
            n->right = erase(n->right, succKey, dummy);
        }
        return rebalance(n);
    }

    static void inorder(Node* n, const function<void(const ProductPtr&)>& f) {
        if (!n) return;
        inorder(n->left, f);
        f(n->val);
        inorder(n->right, f);
    }
    static void reverseOrder(Node* n, const function<void(const ProductPtr&)>& f) {
        if (!n) return;
        reverseOrder(n->right, f);
        f(n->val);
        reverseOrder(n->left, f);
    }
    // visits every key in [lo, hi], pruning subtrees that cannot match
    static void range(Node* n, const Key& lo, const Key& hi,
                      const function<void(const ProductPtr&)>& f) {
        if (!n) return;
        if (!(n->key < lo)) range(n->left, lo, hi, f);
        if (!(n->key < lo) && !(hi < n->key)) f(n->val);
        if (!(hi < n->key)) range(n->right, lo, hi, f);
    }
    // tree -> JSON for the picture in the browser (cut off below maxDepth)
    static void toJson(Node* n, int depth, int maxDepth,
                       const function<string(const Key&)>& fmt, string& out) {
        if (!n) { out += "null"; return; }
        if (depth >= maxDepth) { out += "{\"cut\":true}"; return; }
        out += "{\"key\":" + jstr(fmt(n->key)) + ",\"id\":" + to_string(n->val->id) +
               ",\"h\":" + to_string(n->height) + ",\"bf\":" + to_string(balance(n)) + ",\"l\":";
        toJson(n->left, depth + 1, maxDepth, fmt, out);
        out += ",\"r\":";
        toJson(n->right, depth + 1, maxDepth, fmt, out);
        out += "}";
    }
    static void destroy(Node* n) {
        if (!n) return;
        destroy(n->left);
        destroy(n->right);
        delete n;
    }

public:
    AVLTree() = default;
    AVLTree(const AVLTree&) = delete;
    AVLTree& operator=(const AVLTree&) = delete;
    ~AVLTree() { destroy(root); }

    bool insert(const Key& k, const ProductPtr& v) {
        bool ok = false;
        root = insert(root, k, v, ok);
        if (ok) ++count;
        return ok;
    }
    bool erase(const Key& k) {
        bool ok = false;
        root = erase(root, k, ok);
        if (ok) --count;
        return ok;
    }
    ProductPtr find(const Key& k) const {
        Node* n = root;
        while (n) {
            if (k < n->key)      n = n->left;
            else if (n->key < k) n = n->right;
            else return n->val;
        }
        return nullptr;
    }
    void inorder(const function<void(const ProductPtr&)>& f) const { inorder(root, f); }
    void reverseOrder(const function<void(const ProductPtr&)>& f) const { reverseOrder(root, f); }
    void range(const Key& lo, const Key& hi, const function<void(const ProductPtr&)>& f) const {
        range(root, lo, hi, f);
    }
    string json(int maxDepth, const function<string(const Key&)>& fmt) const {
        string out;
        toJson(root, 0, maxDepth, fmt, out);
        return out;
    }
    size_t size() const { return count; }
    int height() const { return h(root); }
};

// ---------------------------------------------------------------- Helpers
static string toLower(string s) {
    for (auto& c : s) c = (char)tolower((unsigned char)c);
    return s;
}
static string trim(const string& s) {
    size_t a = s.find_first_not_of(" \t\r\n");
    if (a == string::npos) return "";
    size_t b = s.find_last_not_of(" \t\r\n");
    return s.substr(a, b - a + 1);
}

// ---------------------------------------------------------------- Store
class Store {
    AVLTree<int> byId;
    AVLTree<pair<string, int>> byName;
    AVLTree<pair<double, int>> byPrice;

public:
    bool addProduct(int id, const string& name, double price, int stock) {
        if (byId.find(id)) return false;
        auto p = make_shared<Product>(Product{id, name, price, stock});
        byId.insert(id, p);
        byName.insert({toLower(name), id}, p);
        byPrice.insert({price, id}, p);
        return true;
    }
    bool removeProduct(int id) {
        ProductPtr p = byId.find(id);
        if (!p) return false;
        byName.erase({toLower(p->name), id});
        byPrice.erase({p->price, id});
        byId.erase(id);
        return true;
    }
    bool updatePrice(int id, double newPrice) {
        ProductPtr p = byId.find(id);
        if (!p) return false;
        byPrice.erase({p->price, id});      // re-index in the price tree
        p->price = newPrice;
        byPrice.insert({newPrice, id}, p);
        return true;
    }
    // Stock is not a search key in any tree, so no re-indexing is needed: O(log n) to find, O(1) to change.
    bool updateStock(int id, int newStock) {
        ProductPtr p = byId.find(id);
        if (!p) return false;
        p->stock = newStock;
        return true;
    }
    ProductPtr findById(int id) const { return byId.find(id); }

    void searchNamePrefix(const string& prefix, const function<void(const ProductPtr&)>& f) const {
        string p = toLower(prefix);
        byName.range({p, INT_MIN}, {p + char(0x7f), INT_MAX}, f);
    }
    void searchNameContains(const string& text, const function<void(const ProductPtr&)>& f) const {
        string t = toLower(text);          // substring search can't use BST order -> O(n)
        byName.inorder([&](const ProductPtr& p) {
            if (toLower(p->name).find(t) != string::npos) f(p);
        });
    }
    void searchPriceRange(double lo, double hi, const function<void(const ProductPtr&)>& f) const {
        byPrice.range({lo, INT_MIN}, {hi, INT_MAX}, f);
    }

    void listById(bool desc, const function<void(const ProductPtr&)>& f) const {
        desc ? byId.reverseOrder(f) : byId.inorder(f);
    }
    void listByName(bool desc, const function<void(const ProductPtr&)>& f) const {
        desc ? byName.reverseOrder(f) : byName.inorder(f);
    }
    void listByPrice(bool desc, const function<void(const ProductPtr&)>& f) const {
        desc ? byPrice.reverseOrder(f) : byPrice.inorder(f);
    }

    size_t size() const { return byId.size(); }

    string treeJson(const string& which, int maxDepth) const {
        if (which == "name")
            return byName.json(maxDepth, [](const pair<string, int>& k) { return k.first; });
        if (which == "price")
            return byPrice.json(maxDepth, [](const pair<double, int>& k) { return money(k.first); });
        return byId.json(maxDepth, [](const int& k) { return to_string(k); });
    }
    string statsJson() const {
        return "{\"size\":" + to_string(byId.size()) + ",\"hId\":" + to_string(byId.height()) +
               ",\"hName\":" + to_string(byName.height()) + ",\"hPrice\":" + to_string(byPrice.height()) + "}";
    }
};

// ---------------------------------------------------------------- Web API
// Every function returns a JSON string. JavaScript calls these directly.
static Store store;

namespace {

string productJson(const Product& p) {
    return "{\"id\":" + to_string(p.id) + ",\"name\":" + jstr(p.name) + ",\"price\":" + money(p.price) +
           ",\"stock\":" + to_string(p.stock) + "}";
}

// Collects products into a JSON list while a tree is traversed.
struct Collector {
    string items;
    int n = 0;
    void operator()(const ProductPtr& p) {
        if (n++) items += ",";
        items += productJson(*p);
    }
    string result() const {
        return "{\"ok\":true,\"count\":" + to_string(n) + ",\"items\":[" + items + "]}";
    }
};

string reply(bool ok, const string& msg) {
    return string("{\"ok\":") + (ok ? "true" : "false") + ",\"msg\":" + jstr(msg) + "}";
}

}  // namespace

string addProduct(int id, string name, double price, int stock) {
    name = trim(name);
    if (id < 1) return reply(false, "ID must be a whole number of 1 or more.");
    if (name.empty()) return reply(false, "Enter a product name.");
    if (!isfinite(price) || price < 0) return reply(false, "Price must be 0 or more.");
    if (stock < 0) return reply(false, "Stock must be 0 or more.");
    if (!store.addProduct(id, name, price, stock))
        return reply(false, "ID " + to_string(id) + " is already used. Pick a different ID.");
    return reply(true, "Added " + name + ".");
}

string removeProduct(int id) {
    ProductPtr p = store.findById(id);
    if (!p) return reply(false, "No product with ID " + to_string(id) + ".");
    string name = p->name;
    store.removeProduct(id);
    return reply(true, "Removed " + name + ".");
}

string updatePrice(int id, double price) {
    if (!isfinite(price) || price < 0) return reply(false, "Price must be 0 or more.");
    ProductPtr p = store.findById(id);
    if (!p) return reply(false, "No product with ID " + to_string(id) + ".");
    store.updatePrice(id, price);
    return reply(true, "Price of " + p->name + " is now Rs " + money(price) + ".");
}

string updateStock(int id, int stock) {
    if (stock < 0) return reply(false, "Stock must be 0 or more.");
    ProductPtr p = store.findById(id);
    if (!p) return reply(false, "No product with ID " + to_string(id) + ".");
    store.updateStock(id, stock);
    return reply(true, "Stock of " + p->name + " is now " + to_string(stock) + ".");
}

string searchById(int id) {
    Collector c;
    if (auto p = store.findById(id)) c(p);
    return c.result();
}

string searchPrefix(string q) {
    Collector c;
    store.searchNamePrefix(trim(q), [&](const ProductPtr& p) { c(p); });
    return c.result();
}

string searchContains(string q) {
    Collector c;
    store.searchNameContains(trim(q), [&](const ProductPtr& p) { c(p); });
    return c.result();
}

string searchPrice(double lo, double hi) {
    if (lo > hi) swap(lo, hi);
    Collector c;
    store.searchPriceRange(lo, hi, [&](const ProductPtr& p) { c(p); });
    return c.result();
}

// by = "id" | "name" | "price"
string listSorted(string by, bool desc) {
    Collector c;
    auto f = [&](const ProductPtr& p) { c(p); };
    if (by == "name")       store.listByName(desc, f);
    else if (by == "price") store.listByPrice(desc, f);
    else                    store.listById(desc, f);
    return c.result();
}

string loadSample() {
    struct Row { int id; const char* name; double price; int stock; };
    const Row rows[] = {
        {101, "Wireless Mouse", 599, 40},      {102, "Mechanical Keyboard", 3499, 15},
        {103, "USB-C Cable", 299, 120},        {104, "Laptop Stand", 1299, 25},
        {105, "Bluetooth Speaker", 2499, 30},  {106, "Webcam HD", 1899, 18},
        {107, "Noise Cancelling Headphones", 7999, 10}, {108, "Power Bank 20000mAh", 1799, 60},
        {109, "Wireless Earbuds", 2999, 35},   {110, "Smart Watch", 4999, 12},
        {111, "Monitor 24 inch", 8999, 8},     {112, "Phone Case", 399, 200},
        {113, "Wireless Charger", 1499, 22},   {114, "Gaming Mouse", 1999, 27},
        {115, "HDMI Cable", 349, 90},
    };
    int added = 0;
    for (const auto& r : rows) added += store.addProduct(r.id, r.name, r.price, r.stock);
    return reply(true, "Loaded " + to_string(added) + " sample products.");
}

// which = "id" | "name" | "price"
string treeJson(string which) { return store.treeJson(which, 6); }

string stats() { return store.statsJson(); }

// Inserts 1..n in sorted order into a fresh AVL tree and reports its height.
string balanceDemo(int n) {
    n = max(1, min(n, 100000));
    AVLTree<int> t;
    auto dummy = make_shared<Product>(Product{0, "", 0, 0});
    for (int i = 1; i <= n; ++i) t.insert(i, dummy);
    return "{\"n\":" + to_string(n) + ",\"bstHeight\":" + to_string(n) + ",\"avlHeight\":" +
           to_string(t.height()) + ",\"bound\":" + money(1.44 * log2((double)n + 2)) + "}";
}

// ---------------------------------------------------------------- Bindings
#ifdef __EMSCRIPTEN__
#include <emscripten/bind.h>
EMSCRIPTEN_BINDINGS(shop) {
    emscripten::function("addProduct", &addProduct);
    emscripten::function("removeProduct", &removeProduct);
    emscripten::function("updatePrice", &updatePrice);
    emscripten::function("updateStock", &updateStock);
    emscripten::function("searchById", &searchById);
    emscripten::function("searchPrefix", &searchPrefix);
    emscripten::function("searchContains", &searchContains);
    emscripten::function("searchPrice", &searchPrice);
    emscripten::function("listSorted", &listSorted);
    emscripten::function("loadSample", &loadSample);
    emscripten::function("treeJson", &treeJson);
    emscripten::function("stats", &stats);
    emscripten::function("balanceDemo", &balanceDemo);
}
#endif

// ---------------------------------------------------------------- Native test
#ifdef SHOP_NATIVE_TEST
#include <iostream>
int main() {
    cout << loadSample() << "\n";
    cout << addProduct(101, "Dup", 1, 1) << "\n";
    cout << addProduct(200, "Wireless \"Pro\" Mouse", 899.5, 5) << "\n";
    cout << searchPrefix("wire") << "\n";
    cout << searchContains("mouse") << "\n";
    cout << searchPrice(1000, 2500) << "\n";
    cout << searchById(110) << "\n";
    cout << updatePrice(110, 1) << "\n";
    cout << updateStock(110, 3) << "\n";
    cout << updateStock(110, -1) << "\n";
    cout << updateStock(999, 3) << "\n";
    cout << listSorted("price", false) << "\n";
    cout << removeProduct(103) << "\n";
    cout << removeProduct(103) << "\n";
    cout << treeJson("id") << "\n";
    cout << treeJson("name") << "\n";
    cout << stats() << "\n";
    cout << balanceDemo(100000) << "\n";
    return 0;
}
#endif

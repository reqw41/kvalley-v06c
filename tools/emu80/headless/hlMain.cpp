// Headless-обвязка Emu80 для сверки тайминга Вектор-06Ц (проект King's Valley).
// Режимы (env HL_MODE): info | probe | race | game
//   probe: HL_SYM=<sym> HL_HOOKS=имя1,имя2|0xADDR  HL_FRAMES=N — печатает такты хуков (пост-IRQ)
//   race:  HL_SYM, HL_POKE_LXI=<label DVAL>, HL_POKE_JMP=<label SJMP>, HL_WSTA=<label>,
//          HL_D0,HL_D1,HL_DSTEP (итерации), HL_PIX=x,y — порог гонки с лучом
//   game:  HL_FRAMES, HL_PEEK=0xADDR,..., HL_KEYS=<файл: "frame KEY 1|0">, HL_CRC=1
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cstdint>
#include <string>
#include <vector>
#include <map>
#include <fstream>
#include <sstream>
#include <iostream>

#include "../Pal.h"
#include "../PalKeys.h"
#include "../CmdLine.h"
#include "../Emulation.h"
#include "../EmuObjects.h"
#include "../Cpu.h"
#include "../CpuHook.h"
#include "../Platform.h"
#include "../Memory.h"
#include "../CrtRenderer.h"
#include "../Keyboard.h"

using namespace std;

Emulation* g_emulation = nullptr;

// ---------- глобальный контекст ----------
static Cpu8080Compatible* g_cpu = nullptr;
static EmuObject* g_crt = nullptr;
static IActive* g_crtA = nullptr;
static CrtRenderer* g_crtR = nullptr;
static Ram* g_ram = nullptr;
static Keyboard* g_kbd = nullptr;
static uint64_t g_kDiv = 1, g_tpp = 1, g_frameLen = 1;
static uint64_t g_frameBase = 0; // клок IRQ текущего кадра
static uint64_t g_frameNo = 0;

struct Hit { uint16_t addr; uint64_t clk; uint64_t frame; };
static vector<Hit> g_hits;

class ProbeHook : public CpuHook
{
    public:
        ProbeHook(int addr) : CpuHook(addr) {}
        bool hookProc() override {
            g_hits.push_back({uint16_t(getHookAddr()), g_cpu->getClock(), g_frameNo});
            return false;
        }
};

static void stepFrame()
{
    uint64_t t = g_crtA->getClock();       // ближайшая граница кадра
    g_frameBase = t - g_frameLen;         // IRQ, открывший текущий кадр
    while (g_crtA->getClock() == t) {
        uint64_t cur = g_emulation->getCurClock();
        uint64_t ticks = (t > cur) ? (t - cur + g_kDiv) : g_kDiv;
        g_emulation->exec(ticks);
    }
    g_frameNo++;
}

static long long cycPostIrq(uint64_t clk) { return (long long)(clk - g_frameBase) / (long long)g_kDiv; }

static uint32_t crc32buf(const uint32_t* p, size_t n)
{
    static uint32_t tab[256]; static bool init = false;
    if (!init) { for (uint32_t i = 0; i < 256; i++) { uint32_t c = i; for (int k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320 ^ (c >> 1) : c >> 1; tab[i] = c; } init = true; }
    uint32_t c = 0xFFFFFFFF;
    const uint8_t* b = (const uint8_t*)p;
    for (size_t i = 0; i < n * 4; i++) c = tab[(c ^ b[i]) & 0xFF] ^ (c >> 8);
    return c ^ 0xFFFFFFFF;
}

static map<string, uint16_t> loadSym(const string& path)
{
    map<string, uint16_t> m;
    ifstream f(path);
    string line;
    while (getline(f, line)) {
        // формат sjasm: "name: equ 00123h"
        size_t colon = line.find(':');
        if (colon == string::npos) continue;
        string name = line.substr(0, colon);
        size_t equ = line.find("equ", colon);
        if (equ == string::npos) continue;
        string val = line.substr(equ + 3);
        size_t s = val.find_first_not_of(" \t0");
        if (s == string::npos) continue;
        size_t h = val.find('h', s);
        string hexs = val.substr(s, h == string::npos ? string::npos : h - s);
        m[name] = uint16_t(strtol(hexs.c_str(), nullptr, 16));
    }
    return m;
}

static uint16_t resolveAddr(const string& tok, const map<string, uint16_t>& sym)
{
    if (tok.size() > 2 && tok[0] == '0' && (tok[1] == 'x' || tok[1] == 'X'))
        return uint16_t(strtol(tok.c_str() + 2, nullptr, 16));
    auto it = sym.find(tok);
    if (it != sym.end()) return it->second;
    fprintf(stderr, "unknown symbol: %s\n", tok.c_str());
    exit(2);
}

static vector<string> split(const string& s, char sep)
{
    vector<string> out; string cur; stringstream ss(s);
    while (getline(ss, cur, sep)) if (!cur.empty()) out.push_back(cur);
    return out;
}

static const char* env(const char* n, const char* def = "") { const char* v = getenv(n); return v ? v : def; }

static map<string, EmuKey> keyMap()
{
    return {
        {"SPACE", EK_SPACE}, {"CR", EK_CR}, {"LEFT", EK_LEFT}, {"RIGHT", EK_RIGHT},
        {"UP", EK_UP}, {"DOWN", EK_DOWN},
        {"N", EK_N}, {"H", EK_H}, {"E", EK_E}, {"S", EK_S}, {"P", EK_P},
    };
}

int main(int argc, char** argv)
{
    // базовый путь к dist берём из HL_BASE
    const char* base = env("HL_BASE", nullptr);
    if (base) palSetBasePath(base);

    CmdLine cmdLine(argc, argv);
    palInit(argc, argv);
    new Emulation(cmdLine);

    string mode = env("HL_MODE", "info");

    g_cpu = dynamic_cast<Cpu8080Compatible*>(g_emulation->findObject("vector.cpu"));
    g_crt = g_emulation->findObject("vector.crtRenderer");
    g_crtR = dynamic_cast<CrtRenderer*>(g_crt);
    g_crtA = dynamic_cast<IActive*>(g_crt);
    g_ram = dynamic_cast<Ram*>(g_emulation->findObject("vector.ram"));
    Platform* platform = dynamic_cast<Platform*>(g_emulation->findObject("vector"));
    if (!g_cpu || !g_crtA || !g_ram || !platform) {
        fprintf(stderr, "objects not found (cpu=%p crt=%p ram=%p pl=%p)\n",
                (void*)g_cpu, (void*)g_crt, (void*)g_ram, (void*)platform);
        return 1;
    }
    g_kbd = platform->getKeyboard();

    g_kDiv = g_cpu->getKDiv();
    g_tpp = g_emulation->getFrequency() / 12000000;
    g_frameLen = g_tpp * 768 * 312;

    map<string, uint16_t> sym;
    const char* symPath = env("HL_SYM", nullptr);
    if (symPath) sym = loadSym(symPath);

    if (mode == "info") {
        printf("masterFreq=%lld kDiv=%llu ticksPerPixel=%llu frameLen=%llu cpuCyclesPerFrame=%llu\n",
               (long long)g_emulation->getFrequency(), (unsigned long long)g_kDiv,
               (unsigned long long)g_tpp, (unsigned long long)g_frameLen,
               (unsigned long long)(g_frameLen / g_kDiv));
        return 0;
    }

    if (mode == "probe") {
        int frames = atoi(env("HL_FRAMES", "16"));
        vector<ProbeHook*> hooks;
        for (auto& t : split(env("HL_HOOKS", "0x38"), ',')) {
            ProbeHook* h = new ProbeHook(resolveAddr(t, sym));
            h->setCpu(g_cpu);
            g_cpu->addHook(h);
            hooks.push_back(h);
        }
        for (int f = 0; f < frames; f++) {
            g_hits.clear();
            stepFrame();
            for (auto& h : g_hits) {
                long long cyc = cycPostIrq(h.clk);
                long long px = cyc * (long long)g_kDiv / (long long)g_tpp + 189;
                printf("HIT frame=%llu addr=0x%04X cyc=%lld beamLine=%lld beamPx=%lld\n",
                       (unsigned long long)h.frame, h.addr, cyc, px / 768, px % 768);
            }
        }
        return 0;
    }

    if (mode == "race") {
        uint16_t dval = resolveAddr(env("HL_POKE_LXI"), sym);   // адрес LXI B,nn → операнд +1
        uint16_t sjmp = resolveAddr(env("HL_POKE_JMP"), sym);   // адрес JMP → операнд +1 (low byte)
        uint16_t sled = resolveAddr(env("HL_SLED"), sym);       // база NOP-горки
        uint16_t wsta = resolveAddr(env("HL_WSTA"), sym);       // адрес STA (запись в fb)
        int d0 = atoi(env("HL_D0", "0")), d1 = atoi(env("HL_D1", "1200")), ds = atoi(env("HL_DSTEP", "1"));
        auto pix = split(env("HL_PIX", "4,132"), ',');
        int px = atoi(pix[0].c_str()), py = atoi(pix[1].c_str());
        int nops = atoi(env("HL_NOPS", "0"));

        ProbeHook* h38 = new ProbeHook(0x38); h38->setCpu(g_cpu); g_cpu->addHook(h38);
        ProbeHook* hw = new ProbeHook(wsta); hw->setCpu(g_cpu); g_cpu->addHook(hw);

        uint8_t* ram = g_ram->getDataPtr();
        for (int d = d0; d <= d1; d += ds) {
            ram[dval + 1] = d & 0xFF; ram[dval + 2] = (d >> 8) & 0xFF;
            uint16_t entry = sled + nops;
            ram[sjmp + 1] = entry & 0xFF; ram[sjmp + 2] = (entry >> 8) & 0xFF;
            // 3 кадра на установление, 3 кадра выборки
            for (int f = 0; f < 3; f++) { g_hits.clear(); stepFrame(); }
            int seen = 0; long long wcyc = -1;
            for (int f = 0; f < 3; f++) {
                g_hits.clear();
                stepFrame();
                for (auto& h : g_hits)
                    if (h.addr == wsta) wcyc = cycPostIrq(h.clk);
                EmuPixelData pd = g_crtR->getPixelData();
                if (pd.pixelData && py < pd.height && px < pd.width)
                    if (pd.pixelData[py * pd.width + px] & 0xFFFFFF) seen++;
            }
            printf("RACE d=%d nops=%d writeCyc=%lld seen=%d/3\n", d, nops, wcyc, seen);
        }
        return 0;
    }

    if (mode == "game") {
        int frames = atoi(env("HL_FRAMES", "600"));
        bool doCrc = atoi(env("HL_CRC", "1"));
        vector<uint16_t> peeks;
        for (auto& t : split(env("HL_PEEK", ""), ',')) peeks.push_back(resolveAddr(t, sym));
        // скрипт клавиш: строки "frame KEY 1|0"
        multimap<int, pair<EmuKey, bool>> keyScript;
        auto km = keyMap();
        const char* kf = env("HL_KEYS", nullptr);
        if (kf) {
            ifstream f(kf); int fr; string k; int down;
            while (f >> fr >> k >> down) {
                auto it = km.find(k);
                if (it != km.end()) keyScript.insert({fr, {it->second, down != 0}});
            }
        }
        uint8_t* ram = g_ram->getDataPtr();
        // HL_MEMCRC=start,len — CRC диапазона ОЗУ (рендеро-независимая сверка траектории)
        long mcStart = -1, mcLen = 0;
        auto mc = split(env("HL_MEMCRC", ""), ',');
        if (mc.size() == 2) { mcStart = strtol(mc[0].c_str(), nullptr, 0); mcLen = strtol(mc[1].c_str(), nullptr, 0); }
        for (int f = 0; f < frames; f++) {
            auto range = keyScript.equal_range(f);
            for (auto it = range.first; it != range.second; ++it)
                g_kbd->processKey(it->second.first, it->second.second);
            stepFrame();
            printf("F %d", f);
            if (doCrc) {
                EmuPixelData pd = g_crtR->getPixelData();
                printf(" crc=%08X %dx%d", pd.pixelData ? crc32buf(pd.pixelData, size_t(pd.width) * pd.height) : 0, pd.width, pd.height);
            }
            if (mcStart >= 0) {
                uint32_t c = 0xFFFFFFFF;
                static uint32_t tab[256]; static bool ini = false;
                if (!ini) { for (uint32_t i = 0; i < 256; i++) { uint32_t x = i; for (int k = 0; k < 8; k++) x = (x & 1) ? 0xEDB88320 ^ (x >> 1) : x >> 1; tab[i] = x; } ini = true; }
                for (long i = 0; i < mcLen; i++) c = tab[(c ^ ram[(mcStart + i) & 0xFFFF]) & 0xFF] ^ (c >> 8);
                printf(" memcrc=%08X", c ^ 0xFFFFFFFF);
            }
            for (auto a : peeks) printf(" [%04X]=%02X", a, ram[a]);
            printf("\n");
        }
        return 0;
    }

    fprintf(stderr, "unknown HL_MODE=%s\n", mode.c_str());
    return 1;
}

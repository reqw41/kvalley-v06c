#include <sys/stat.h>
#include <cstdio>

#include "hlPalFile.h"
#include "hlPal.h"

using namespace std;

PalFile::~PalFile() { close(); }

bool PalFile::open(const string& fileName, const string& mode)
{
    close();
    string m = (mode.find('w') != string::npos) ? "wb" : "rb";
    if (mode.find('r') != string::npos && mode.find('w') != string::npos) m = "r+b";
    m_file = fopen(fileName.c_str(), m.c_str());
    return m_file != nullptr;
}

void PalFile::close() { if (m_file) { fclose(m_file); m_file = nullptr; } }
bool PalFile::isOpen() const { return m_file != nullptr; }
bool PalFile::eof() const { return m_file ? getPos() >= getSize() : true; }

uint8_t PalFile::read8() { int c = m_file ? fgetc(m_file) : 0; return c < 0 ? 0 : uint8_t(c); }
uint16_t PalFile::read16() { uint16_t lo = read8(); return lo | (uint16_t(read8()) << 8); }
uint32_t PalFile::read32() { uint32_t lo = read16(); return lo | (uint32_t(read16()) << 16); }
void PalFile::write8(uint8_t v) { if (m_file) fputc(v, m_file); }
void PalFile::write16(uint16_t v) { write8(v & 0xFF); write8(v >> 8); }
void PalFile::write32(uint32_t v) { write16(v & 0xFFFF); write16(v >> 16); }

int64_t PalFile::getSize() const
{
    if (!m_file) return 0;
    long cur = ftell(m_file);
    fseek(m_file, 0, SEEK_END);
    long sz = ftell(m_file);
    fseek(m_file, cur, SEEK_SET);
    return sz;
}

int64_t PalFile::getPos() const { return m_file ? ftell(m_file) : 0; }
void PalFile::seek(int position) { if (m_file) fseek(m_file, position, SEEK_SET); }
void PalFile::skip(int len) { if (m_file) fseek(m_file, len, SEEK_CUR); }

bool PalFile::create(const string& fileName) { FILE* f = fopen(fileName.c_str(), "wb"); if (f) fclose(f); return f != nullptr; }
bool PalFile::del(const string& fileName) { return remove(fileName.c_str()) == 0; }
bool PalFile::mkDir(const string& dirName) { return mkdir(dirName.c_str(), 0755) == 0; }
bool PalFile::moveRename(const string& src, const string& dst) { return rename(src.c_str(), dst.c_str()) == 0; }

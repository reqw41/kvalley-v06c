// Headless PalFile — stdio.
#ifndef HLPALFILE_H
#define HLPALFILE_H

#include <string>
#include <cstdio>
#include <cstdint>

class PalFile
{
    public:
        PalFile() = default;
        ~PalFile();

        bool open(const std::string& fileName, const std::string& mode = "r");
        void close();
        bool isOpen() const;
        bool eof() const;
        uint8_t read8();
        uint16_t read16();
        uint32_t read32();
        void write8(uint8_t value);
        void write16(uint16_t value);
        void write32(uint32_t value);
        int64_t getSize() const;
        int64_t getPos() const;
        void seek(int position);
        void skip(int len);

        static bool create(const std::string& fileName);
        static bool del(const std::string& fileName);
        static bool mkDir(const std::string& dirName);
        static bool moveRename(const std::string& src, const std::string& dst);

    private:
        FILE* m_file = nullptr;
};

#endif // HLPALFILE_H

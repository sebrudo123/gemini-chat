cmake_minimum_required(VERSION 3.22.1)
project(coreia_rpc CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# SDK oficial de Discord (Social SDK). Las cabeceras viven en ./include y la
# librería nativa se empaqueta desde jniLibs (una por ABI).
add_library(discord_partner_sdk SHARED IMPORTED)
set_target_properties(discord_partner_sdk PROPERTIES
        IMPORTED_LOCATION "${CMAKE_CURRENT_SOURCE_DIR}/../jniLibs/${ANDROID_ABI}/libdiscord_partner_sdk.so")

add_library(coreia_rpc SHARED discord_rpc.cpp)
target_include_directories(coreia_rpc PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/include")
target_link_libraries(coreia_rpc discord_partner_sdk log)

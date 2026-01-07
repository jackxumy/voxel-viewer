import struct
import os
import math
import json
from collections import defaultdict

# ================= 配置项 =================
INPUT_FILE = 'voxel.bin'
OUTPUT_DIR = 'chunks_iterative'

# 基础配置
BASE_VOXEL_SIZE = 0.5         # LOD0 的体素物理大小
CHUNK_DIMENSION = 32          # 一个区块包含多少个体素 (32 x 32 x 32)
MAX_VOXEL_SIZE = 4.0          # 最大体素大小

RECORD_SIZE = 49              # 原始数据每条记录大小
# =========================================

def ensure_dir(directory):
    if not os.path.exists(directory):
        os.makedirs(directory)

def load_raw_points(file_path):
    points = []
    if not os.path.exists(file_path):
        print(f"Error: {file_path} not found.")
        return []

    file_size = os.path.getsize(file_path)
    count = file_size // RECORD_SIZE
    print(f"Loading {count} records from {file_path}...")

    # todo：流式或分块读取
    with open(file_path, 'rb') as f:
        buffer = f.read() 
        for i in range(count):
            offset = i * RECORD_SIZE
            data_slice = buffer[offset : offset + 25]
            x, y, z = struct.unpack('<ddd', data_slice[0:24])
            filled = struct.unpack('<B', data_slice[24:25])[0]
            
            if filled:
                points.append((x, y, z))
    
    print(f"Loaded {len(points)} valid raw points.")
    return points

# 解算出每一个体素的在模型中的索引号
def init_lod0_grid(raw_points, voxel_size):
    print("Initializing LOD0 grid ID...")
    grid_voxels = set()
    for x, y, z in raw_points:
        gx = math.floor(x / voxel_size)
        gy = math.floor(y / voxel_size)
        gz = math.floor(z / voxel_size)
        grid_voxels.add((gx, gy, gz))
    return grid_voxels

# 下采样（利用原有的索引计算下一层的索引，只要有一个小体素存在，整块都会保留，集合会自动合并重复的大体素）
def downsample_grid(current_voxels):
    next_voxels = set()
    for gx, gy, gz in current_voxels:
        # 使用位运算 >> 1 等同于 // 2，但在大量数据下可能略快且语义明确
        next_gx = gx >> 1
        next_gy = gy >> 1
        next_gz = gz >> 1
        next_voxels.add((next_gx, next_gy, next_gz))
    
    return next_voxels

def save_chunks(grid_voxels, lod_level, voxel_size):
    print(f"\n--- Processing LOD {lod_level} (Voxel Size: {voxel_size}) ---")
    print(f"Total Voxels: {len(grid_voxels)}")

    # 1. 切分区块 (Slicing)
    # 这里的 key 是区块的索引，value 是该区块内体素的世界坐标列表
    chunks = defaultdict(list)
    
    for gx, gy, gz in grid_voxels:
        # 得到体素所在区块的索引
        cx = gx // CHUNK_DIMENSION
        cy = gy // CHUNK_DIMENSION
        cz = gz // CHUNK_DIMENSION

        # 计算体素的浮点真实坐标
        wx = (gx + 0.5) * voxel_size
        wy = (gy + 0.5) * voxel_size
        wz = (gz + 0.5) * voxel_size
        
        # 将体素加入到这个区块中
        chunks[(cx, cy, cz)].append((wx, wy, wz))

    print(f"Generated {len(chunks)} chunks (Dimension: {CHUNK_DIMENSION}x{CHUNK_DIMENSION}x{CHUNK_DIMENSION} voxels).")

    # 2. 写入文件
    lod_dir = os.path.join(OUTPUT_DIR, str(lod_level))
    ensure_dir(lod_dir)
    
    level_manifest = {}

    for chunk_key, voxels in chunks.items():
        cx, cy, cz = chunk_key
        chunk_name = f"{cx}_{cy}_{cz}"
        filename = f"chunk_{chunk_name}.bin"
        file_path = os.path.join(lod_dir, filename)
        
        # 写入二进制 (float32 x, y, z)
        out_data = bytearray()
        for vx, vy, vz in voxels:
            out_data.extend(struct.pack('<fff', vx, vy, vz))
            
        with open(file_path, 'wb') as f:
            f.write(out_data)

        # 记录元数据
        # 该区块在物理世界的原点坐标
        chunk_phys_origin_size = CHUNK_DIMENSION * voxel_size
        level_manifest[chunk_name] = {
            "file": filename,
            "x": cx * chunk_phys_origin_size,
            "y": cy * chunk_phys_origin_size,
            "z": cz * chunk_phys_origin_size,
            "count": len(voxels)
        }
        
    return level_manifest

def main():
    # 1. 读取原始数据
    raw_points = load_raw_points(INPUT_FILE)
    if not raw_points:
        return

    ensure_dir(OUTPUT_DIR)
    
    global_manifest = {
        "base_voxel_size": BASE_VOXEL_SIZE,
        "chunk_dimension": CHUNK_DIMENSION,
        "levels": {}
    }

    current_voxel_size = BASE_VOXEL_SIZE
    
    current_grid_voxels = init_lod0_grid(raw_points, current_voxel_size)
    
    lod_level = 0

    while current_voxel_size <= MAX_VOXEL_SIZE:
        level_data = save_chunks(current_grid_voxels, lod_level, current_voxel_size)
        
        global_manifest["levels"][lod_level] = {
            "voxel_size": current_voxel_size,
            "chunk_physical_size": CHUNK_DIMENSION * current_voxel_size,
            "chunks": level_data
        }
        
        # 检查是否需要继续下一级
        # 如果当前尺寸已经是最大尺寸，就不需要再降采样了，直接退出
        if current_voxel_size >= MAX_VOXEL_SIZE:
            break
            
        # --- 核心步骤 B: 降采样 (生成新的模型) ---
        print(f"Downsampling model (LOD {lod_level} -> LOD {lod_level+1})...")
        current_grid_voxels = downsample_grid(current_grid_voxels)
        
        # 更新参数为下一级准备
        current_voxel_size *= 2
        lod_level += 1

    # 4. 保存总清单
    with open(os.path.join(OUTPUT_DIR, 'manifest.json'), 'w') as f:
        json.dump(global_manifest, f, indent=2)
    
    print(f"\nProcessing complete! Output saved to '{OUTPUT_DIR}/'")

if __name__ == "__main__":
    main()
import { StorageInfo } from '@dash/common';
import * as si from 'systeminformation';
import { CONFIG } from '../../config';
import { getStaticServerInfo } from '../../static-info';
import { platformIsWindows } from '../../utils';

type Block = si.Systeminformation.BlockDevicesData;
type Disk = si.Systeminformation.DiskLayoutData;
type Size = si.Systeminformation.FsSizeData;

const getDiskBlocks = (blocks: Block[]) =>
  blocks.filter(
    block =>
      block.type === 'disk' &&
      block.size > 0 &&
      !CONFIG.fs_device_filter.includes(block.name) &&
      !CONFIG.fs_type_filter.includes(block.fsType)
  );

const getNativeDisk = (
  disks: Disk[],
  block: Block
): {
  vendor: string;
  size: number;
  type: string;
  interfaceType?: string;
} =>
  disks.find(
    d =>
      d.device === block.device || (block.model != '' && d.name === block.model)
  ) ?? {
    vendor: block.name,
    size: block.size,
    type: block.physical,
  };

const getVirtualMountsLayout = (sizes: Size[]) =>
  CONFIG.fs_virtual_mounts
    .map(mount => {
      const size = sizes.find(s => s.fs === mount);

      return size
        ? {
            device: size.fs,
            brand: size.fs,
            type: 'VIRTUAL',
            size: size.size,
            virtual: true,
          }
        : undefined;
    })
    .filter(d => d != null);

const getRaidLabel = (deviceName: string, allRaidBlocks: Block[]) => {
  const raidBlocks = allRaidBlocks.filter(m => m.name.startsWith(deviceName));
  const uuids = raidBlocks.map(rb => rb.uuid);

  if (raidBlocks.length > 0) {
    const isSplit = raidBlocks[0].label.includes(':');

    if (isSplit) {
      const splitLabel = raidBlocks[0].label.split(':')[0];
      const hasUniqueName = !allRaidBlocks
        .filter(
          rb => !rb.name.startsWith(deviceName) && !uuids.includes(rb.uuid)
        )
        .some(rb => {
          const startSame = rb.label.split(':')[0] === splitLabel;
          const isSame = rb.label === raidBlocks[0].label;

          return startSame && !isSame;
        });

      return hasUniqueName ? splitLabel : raidBlocks[0].label;
    } else {
      return raidBlocks[0].label;
    }
  }

  return undefined;
};

const getDiskType = (type: string, interfaceType?: string) => {
  return type === 'SSD' && interfaceType === 'NVMe' ? 'NVMe' : type;
};

export const mapToStorageLayout = (
  hostWin32: boolean,
  disks: Disk[],
  blocks: Block[],
  sizes: Size[]
) => {
  const raidBlocks = blocks.filter(block => block.fsType.endsWith('_member'));
  const diskBlocks = getDiskBlocks(blocks);

  const mapDiskBlock = (diskBlock: Block) => {
    const device = diskBlock.name;
    const nativeDisk = getNativeDisk(disks, diskBlock);
    const raidLabel = getRaidLabel(device, raidBlocks);

    const layout: StorageInfo['layout'][number] = {
      device: hostWin32 ? diskBlock.device : device,
      brand: nativeDisk.vendor,
      size: nativeDisk.size,
      type: getDiskType(nativeDisk.type, nativeDisk.interfaceType),
    };

    if (raidLabel != null) {
      layout.raidGroup = raidLabel;
    }

    return layout;
  };

  const blockLayout = (
    hostWin32
      ? diskBlocks.reduce((acc, curr) => {
          if (curr.device && !acc.some(b => b.device === curr.device)) {
            acc.push(curr);
          }
          return acc;
        }, [] as Block[])
      : diskBlocks
  ).map(mapDiskBlock);

  const sizesLayout = getVirtualMountsLayout(sizes);

  return blockLayout.concat(sizesLayout);
};

export default async (): Promise<StorageInfo> => {
  const svInfo = getStaticServerInfo();
  const [disks, blocks, sizes] = await Promise.all([
    si.diskLayout(),
    si.blockDevices(),
    si.fsSize(),
  ]);

  return {
    layout: mapToStorageLayout(
      platformIsWindows(svInfo.os.platform),
      disks,
      blocks,
      sizes
    ),
  };
};

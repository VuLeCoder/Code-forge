import { SetMetadata } from '@nestjs/common';

export const ALLOW_DURING_WRITE_FREEZE = 'allowDuringWriteFreeze';

export const AllowDuringWriteFreeze = () => SetMetadata(ALLOW_DURING_WRITE_FREEZE, true);

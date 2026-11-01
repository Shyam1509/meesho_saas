import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { ProductMappingService } from './product-mapping.service';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

/**
 * Products, effective-dated costs and the product ↔ order mapping (Milestone 6). Exports the mapping
 * service so the import confirm can run it inside its own transaction.
 */
@Module({
  imports: [AuthorizationModule, AuditModule],
  controllers: [ProductsController],
  providers: [ProductsService, ProductMappingService],
  exports: [ProductMappingService],
})
export class ProductsModule {}

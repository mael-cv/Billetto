import { type DynamicModule, Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import type { AppConfig } from './common/config/config';
import { ConfigModule } from './common/config/config.module';
import { DatabaseModule } from './common/database/database.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { EventTypesModule } from './modules/event-types/event-types.module';
import { EventsModule } from './modules/events/events.module';
import { HealthModule } from './modules/health/health.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { TicketsModule } from './modules/tickets/tickets.module';
import { UsersModule } from './modules/users/users.module';
import { VenuesModule } from './modules/venues/venues.module';

@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(config),
        DatabaseModule,
        AuthModule,
        HealthModule,
        EventsModule,
        PricingModule,
        EventTypesModule,
        VenuesModule,
        OrdersModule,
        PaymentsModule,
        TicketsModule,
        UsersModule,
        AnalyticsModule,
      ],
    };
  }
}

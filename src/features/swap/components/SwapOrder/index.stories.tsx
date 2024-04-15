import type { Meta, StoryObj } from '@storybook/react'
import { SellOrder as SellOrderComponent } from './index'
import { Paper } from '@mui/material'

const meta = {
  component: SellOrderComponent,
  parameters: {
    componentSubtitle: 'Renders a Status label with icon and text for a swap order',
  },

  decorators: [
    (Story) => {
      return (
        <Paper sx={{ padding: 2 }}>
          <Story />
        </Paper>
      )
    },
  ],
  tags: ['autodocs'],
} satisfies Meta<typeof SellOrderComponent>

export default meta
type Story = StoryObj<typeof meta>

export const SellOrder: Story = {
  args: {
    order: {
      type: 'SwapOrder',
      humanDescription: null,
      richDecodedInfo: null,
      orderUid:
        '0xdfbc181c3cea514808cf74363a1914a9988881db2d125b026c3e5feffb359f9e7a9af6ef9197041a5841e84cb27873bebd3486e26613f9d1',
      status: 'fulfilled',
      orderKind: 'sell',
      sellToken: {
        logo: 'https://safe-transaction-assets.staging.5afe.dev/tokens/logos/0x0625aFB445C3B6B7B929342a04A22599fd5dBB59.png',
        symbol: 'COW',
        amount: '5',
      },
      buyToken: {
        logo: 'https://safe-transaction-assets.staging.5afe.dev/tokens/logos/0xbe72E441BF55620febc26715db68d3494213D8Cb.png',
        symbol: 'USDC',
        amount: '34.240403272089864',
      },
      expiresTimestamp: 1712585169,
      filledPercentage: '100.00',
      explorerUrl:
        'https://explorer.cow.fi/orders/0xdfbc181c3cea514808cf74363a1914a9988881db2d125b026c3e5feffb359f9e7a9af6ef9197041a5841e84cb27873bebd3486e26613f9d1',
      feeLabel: '0.06804026182145945 COW',
      executionPriceLabel: '1 COW = 0.14508041726505666 USDC',
      surplusLabel: '0.22324174807285857 USDC',
    },
  },
}

import type { NewSafeFormData } from '@/components/new-safe/create'
import { CREATION_MODAL_QUERY_PARM } from '@/components/new-safe/create/logic'
import { LATEST_SAFE_VERSION, POLLING_INTERVAL } from '@/config/constants'
import { AppRoutes } from '@/config/routes'
import { safeCreationDispatch, SafeCreationEvent } from '@/features/counterfactual/services/safeCreationEvents'
import { addUndeployedSafe } from '@/features/counterfactual/store/undeployedSafesSlice'
import { type ConnectedWallet } from '@/hooks/wallets/useOnboard'
import { createWeb3, getWeb3ReadOnly } from '@/hooks/wallets/web3'
import { asError } from '@/services/exceptions/utils'
import ExternalStore from '@/services/ExternalStore'
import { assertWalletChain, getUncheckedSafeSDK, tryOffChainTxSigning } from '@/services/tx/tx-sender/sdk'
import { getRelayTxStatus, TaskState } from '@/services/tx/txMonitor'
import type { AppDispatch } from '@/store'
import { addOrUpdateSafe } from '@/store/addedSafesSlice'
import { upsertAddressBookEntry } from '@/store/addressBookSlice'
import { showNotification } from '@/store/notificationsSlice'
import { defaultSafeInfo } from '@/store/safeInfoSlice'
import { getBlockExplorerLink } from '@/utils/chains'
import { didReprice, didRevert, type EthersError } from '@/utils/ethers-utils'
import { assertOnboard, assertTx, assertWallet } from '@/utils/helpers'
import type { DeploySafeProps, PredictedSafeProps } from '@safe-global/protocol-kit'
import { ZERO_ADDRESS } from '@safe-global/protocol-kit/dist/src/utils/constants'
import type { SafeTransaction, SafeVersion, TransactionOptions } from '@safe-global/safe-core-sdk-types'
import {
  type ChainInfo,
  ImplementationVersionState,
  type SafeBalanceResponse,
  type SafeInfo,
  TokenType,
} from '@safe-global/safe-gateway-typescript-sdk'
import type { OnboardAPI } from '@web3-onboard/core'
import type { BrowserProvider, ContractTransactionResponse, Provider } from 'ethers'
import type { NextRouter } from 'next/router'

export const getUndeployedSafeInfo = (undeployedSafe: PredictedSafeProps, address: string, chainId: string) => {
  return Promise.resolve({
    ...defaultSafeInfo,
    address: { value: address },
    chainId,
    owners: undeployedSafe.safeAccountConfig.owners.map((owner) => ({ value: owner })),
    nonce: 0,
    threshold: undeployedSafe.safeAccountConfig.threshold,
    implementationVersionState: ImplementationVersionState.UP_TO_DATE,
    fallbackHandler: { value: undeployedSafe.safeAccountConfig.fallbackHandler! },
    version: undeployedSafe.safeDeploymentConfig?.safeVersion || LATEST_SAFE_VERSION,
    deployed: false,
  })
}

export const CF_TX_GROUP_KEY = 'cf-tx'

export const dispatchTxExecutionAndDeploySafe = async (
  safeTx: SafeTransaction,
  txOptions: TransactionOptions,
  onboard: OnboardAPI,
  chainId: SafeInfo['chainId'],
) => {
  const sdkUnchecked = await getUncheckedSafeSDK(onboard, chainId)
  const safeAddress = await sdkUnchecked.getAddress()
  const eventParams = { groupKey: CF_TX_GROUP_KEY }

  let result: ContractTransactionResponse | undefined
  try {
    const signedTx = await tryOffChainTxSigning(safeTx, await sdkUnchecked.getContractVersion(), sdkUnchecked)

    const wallet = await assertWalletChain(onboard, chainId)
    const provider = createWeb3(wallet.provider)
    const signer = await provider.getSigner()

    const deploymentTx = await sdkUnchecked.wrapSafeTransactionIntoDeploymentBatch(signedTx, txOptions)

    // We need to estimate the actual gasLimit after the user has signed since it is more accurate than what useDeployGasLimit returns
    const gas = await signer.estimateGas({ data: deploymentTx.data, value: deploymentTx.value, to: deploymentTx.to })

    // @ts-ignore TODO: Check why TransactionResponse type doesn't work
    result = await signer.sendTransaction({ ...deploymentTx, gasLimit: gas })
  } catch (error) {
    safeCreationDispatch(SafeCreationEvent.FAILED, { ...eventParams, error: asError(error) })
    throw error
  }

  safeCreationDispatch(SafeCreationEvent.PROCESSING, { ...eventParams, txHash: result!.hash })

  result
    ?.wait()
    .then((receipt) => {
      if (receipt === null) {
        safeCreationDispatch(SafeCreationEvent.FAILED, {
          ...eventParams,
          error: new Error('No transaction receipt found'),
        })
      } else if (didRevert(receipt)) {
        safeCreationDispatch(SafeCreationEvent.REVERTED, {
          ...eventParams,
          error: new Error('Transaction reverted by EVM'),
        })
      } else {
        safeCreationDispatch(SafeCreationEvent.SUCCESS, { ...eventParams, safeAddress })
      }
    })
    .catch((err) => {
      const error = err as EthersError

      if (didReprice(error)) {
        safeCreationDispatch(SafeCreationEvent.SUCCESS, { ...eventParams, safeAddress })
      } else {
        safeCreationDispatch(SafeCreationEvent.FAILED, { ...eventParams, error: asError(error) })
      }
    })

  return result!.hash
}

export const deploySafeAndExecuteTx = async (
  txOptions: TransactionOptions,
  chainId: string,
  wallet: ConnectedWallet | null,
  safeTx?: SafeTransaction,
  onboard?: OnboardAPI,
) => {
  assertTx(safeTx)
  assertWallet(wallet)
  assertOnboard(onboard)

  return dispatchTxExecutionAndDeploySafe(safeTx, txOptions, onboard, chainId)
}

export const { getStore: getNativeBalance, setStore: setNativeBalance } = new ExternalStore<bigint>(0n)

export const getCounterfactualBalance = async (
  safeAddress: string,
  provider?: BrowserProvider,
  chain?: ChainInfo,
  ignoreCache?: boolean,
) => {
  let balance: bigint | undefined

  if (!chain) return undefined

  // Fetch balance via the connected wallet.
  // If there is no wallet connected we fetch and cache the balance instead
  if (provider) {
    balance = await provider.getBalance(safeAddress)
  } else {
    const cachedBalance = getNativeBalance()
    const useCache = cachedBalance && cachedBalance > 0n && !ignoreCache
    balance = useCache ? cachedBalance : (await getWeb3ReadOnly()?.getBalance(safeAddress)) || 0n
    setNativeBalance(balance)
  }

  return <SafeBalanceResponse>{
    fiatTotal: '0',
    items: [
      {
        tokenInfo: {
          type: TokenType.NATIVE_TOKEN,
          address: ZERO_ADDRESS,
          ...chain?.nativeCurrency,
        },
        balance: balance?.toString(),
        fiatBalance: '0',
        fiatConversion: '0',
      },
    ],
  }
}

export const createCounterfactualSafe = (
  chain: ChainInfo,
  safeAddress: string,
  saltNonce: string,
  data: NewSafeFormData,
  dispatch: AppDispatch,
  props: DeploySafeProps,
  router: NextRouter,
) => {
  const undeployedSafe = {
    chainId: chain.chainId,
    address: safeAddress,
    safeProps: {
      safeAccountConfig: props.safeAccountConfig,
      safeDeploymentConfig: {
        saltNonce,
        safeVersion: LATEST_SAFE_VERSION as SafeVersion,
      },
    },
  }

  dispatch(addUndeployedSafe(undeployedSafe))
  dispatch(upsertAddressBookEntry({ chainId: chain.chainId, address: safeAddress, name: data.name }))
  dispatch(
    addOrUpdateSafe({
      safe: {
        ...defaultSafeInfo,
        address: { value: safeAddress, name: data.name },
        threshold: data.threshold,
        owners: data.owners.map((owner) => ({
          value: owner.address,
          name: owner.name || owner.ens,
        })),
        chainId: chain.chainId,
      },
    }),
  )
  router.push({
    pathname: AppRoutes.home,
    query: { safe: `${chain.shortName}:${safeAddress}`, [CREATION_MODAL_QUERY_PARM]: true },
  })
}

export const showSubmitNotification = (dispatch: AppDispatch, chain?: ChainInfo, txHash?: string) => {
  const link = chain && txHash ? getBlockExplorerLink(chain, txHash) : undefined
  dispatch(
    showNotification({
      variant: 'info',
      groupKey: CF_TX_GROUP_KEY,
      message: 'Safe Account activation in progress',
      detailedMessage: 'Your Safe Account will be deployed onchain after the transaction is executed.',
      link: link ? { href: link.href, title: link.title } : undefined,
    }),
  )
}

// TODO: Reuse this for safe creation flow instead of checkSafeCreationTx
export const checkSafeActivation = async (
  provider: Provider,
  txHash: string,
  safeAddress: string,
  startBlock?: number,
) => {
  const TIMEOUT_TIME = 2 * 60 * 1000 // 2 minutes

  try {
    const txResponse = await provider.getTransaction(txHash)
    if (txResponse === null) {
      throw new Error('Transaction not found')
    }

    const replaceableTx = startBlock ? txResponse.replaceableTransaction(startBlock) : txResponse
    const receipt = await replaceableTx.wait(1, TIMEOUT_TIME)

    /** The receipt should always be non-null as we require 1 confirmation */
    if (receipt === null) {
      throw new Error('Transaction should have a receipt, but got null instead.')
    }

    if (didRevert(receipt)) {
      safeCreationDispatch(SafeCreationEvent.REVERTED, {
        groupKey: CF_TX_GROUP_KEY,
        error: new Error('Transaction reverted'),
      })
    }

    safeCreationDispatch(SafeCreationEvent.SUCCESS, {
      groupKey: CF_TX_GROUP_KEY,
      safeAddress,
    })
  } catch (err) {
    const _err = err as EthersError

    if (_err.reason === 'replaced' || _err.reason === 'repriced') {
      safeCreationDispatch(SafeCreationEvent.SUCCESS, {
        groupKey: CF_TX_GROUP_KEY,
        safeAddress,
      })
      return
    }

    safeCreationDispatch(SafeCreationEvent.FAILED, {
      groupKey: CF_TX_GROUP_KEY,
      error: _err,
    })
  }
}

// TODO: Reuse this for safe creation flow instead of waitForCreateSafeTx
export const checkSafeActionViaRelay = (taskId: string, safeAddress: string) => {
  const TIMEOUT_TIME = 2 * 60 * 1000 // 2 minutes

  let intervalId: NodeJS.Timeout
  let failAfterTimeoutId: NodeJS.Timeout

  intervalId = setInterval(async () => {
    const status = await getRelayTxStatus(taskId)

    // 404
    if (!status) return

    switch (status.task.taskState) {
      case TaskState.ExecSuccess:
        safeCreationDispatch(SafeCreationEvent.SUCCESS, {
          groupKey: CF_TX_GROUP_KEY,
          safeAddress,
        })
        break
      case TaskState.ExecReverted:
      case TaskState.Blacklisted:
      case TaskState.Cancelled:
      case TaskState.NotFound:
        safeCreationDispatch(SafeCreationEvent.FAILED, {
          groupKey: CF_TX_GROUP_KEY,
          error: new Error('Transaction failed'),
        })
        break
      default:
        // Don't clear interval as we're still waiting for the tx to be relayed
        return
    }

    clearTimeout(failAfterTimeoutId)
    clearInterval(intervalId)
  }, POLLING_INTERVAL)

  failAfterTimeoutId = setTimeout(() => {
    safeCreationDispatch(SafeCreationEvent.FAILED, {
      groupKey: CF_TX_GROUP_KEY,
      error: new Error('Transaction failed'),
    })

    clearInterval(intervalId)
  }, TIMEOUT_TIME)
}

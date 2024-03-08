import { getSafeInfo, type ChainInfo } from '@safe-global/safe-gateway-typescript-sdk'
import { useCallback, useMemo } from 'react'
import {
  ListItemButton,
  Box,
  Typography,
  Chip,
  SvgIcon,
  IconButton,
  Tooltip,
  ListItemSecondaryAction,
} from '@mui/material'
import VisibilityIcon from '@mui/icons-material/Visibility'
import Link from 'next/link'
import SafeIcon from '@/components/common/SafeIcon'
import Track from '@/components/common/Track'
import { OVERVIEW_EVENTS, OVERVIEW_LABELS } from '@/services/analytics'
import { AppRoutes } from '@/config/routes'
import { useAppDispatch, useAppSelector } from '@/store'
import { selectChainById } from '@/store/chainsSlice'
import ChainIndicator from '@/components/common/ChainIndicator'
import css from './styles.module.css'
import { selectAllAddressBooks } from '@/store/addressBookSlice'
import { shortenAddress } from '@/utils/formatters'
import SafeListContextMenu from '@/components/sidebar/SafeListContextMenu'
import useSafeAddress from '@/hooks/useSafeAddress'
import useChainId from '@/hooks/useChainId'
import { sameAddress } from '@/utils/addresses'
import classnames from 'classnames'
import { useRouter } from 'next/router'
import BookmarkIcon from '@/public/images/apps/bookmark.svg'
import BookmarkedIcon from '@/public/images/apps/bookmarked.svg'
import { addSafeToWatchlist } from '@/components/new-safe/load/logic'
import { removeSafe } from '@/store/addedSafesSlice'

type AccountItemProps = {
  chainId: string
  address: string
  isReadOnly: boolean
  isBookmarked: boolean
  threshold?: number
  owners?: number
  onLinkClick?: () => void
  onBookmarkClick?: () => void
}

const AccountItem = ({
  onLinkClick,
  onBookmarkClick,
  chainId,
  address,
  isReadOnly,
  isBookmarked,
  ...rest
}: AccountItemProps) => {
  const chain = useAppSelector((state) => selectChainById(state, chainId))
  const safeAddress = useSafeAddress()
  const currChainId = useChainId()
  const router = useRouter()
  const dispatch = useAppDispatch()
  const isCurrentSafe = chainId === currChainId && sameAddress(safeAddress, address)
  const isWelcomePage = router.pathname === AppRoutes.welcome.accounts
  const isSingleTxPage = router.pathname === AppRoutes.transactions.tx

  const trackingLabel = isWelcomePage ? OVERVIEW_LABELS.login_page : OVERVIEW_LABELS.sidebar

  // const handleBookmarkClick = async () => {
  //   const safeInfo = await getSafeInfo(chainId, address)
  //   addSafeToWatchlist(dispatch, safeInfo, '')
  // }

  const addToBookmarks = async () => {
    const safeInfo = await getSafeInfo(chainId, address)
    addSafeToWatchlist(dispatch, safeInfo, '')
  }

  const removeFromBookmarks = () => {
    dispatch(removeSafe({ chainId, address }))
  }

  /**
   * Navigate to the dashboard when selecting a safe on the welcome page,
   * navigate to the history when selecting a safe on a single tx page,
   * otherwise keep the current route
   */
  const getHref = useCallback(
    (chain: ChainInfo, address: string) => {
      return {
        pathname: isWelcomePage ? AppRoutes.home : isSingleTxPage ? AppRoutes.transactions.history : router.pathname,
        query: { ...router.query, safe: `${chain.shortName}:${address}` },
      }
    },
    [isWelcomePage, isSingleTxPage, router.pathname, router.query],
  )

  const href = useMemo(() => {
    return chain ? getHref(chain, address) : ''
  }, [chain, getHref, address])

  const name = useAppSelector(selectAllAddressBooks)[chainId]?.[address]

  return (
    <ListItemButton
      data-testid="safe-list-item"
      selected={isCurrentSafe}
      className={classnames(css.listItem, { [css.currentListItem]: isCurrentSafe })}
    >
      <Track {...OVERVIEW_EVENTS.OPEN_SAFE} label={trackingLabel}>
        <Link onClick={onLinkClick} href={href} className={css.safeLink}>
          <SafeIcon address={address} {...rest} />

          <Typography variant="body2" component="div" className={css.safeAddress}>
            {name && (
              <Typography fontWeight="bold" fontSize="inherit">
                {name}
              </Typography>
            )}
            <b>{chain?.shortName}: </b>
            <Typography color="var(--color-primary-light)" fontSize="inherit" component="span">
              {shortenAddress(address)}
            </Typography>
            <br />
            {isReadOnly && (
              <Chip
                className={css.readOnlyChip}
                variant="outlined"
                size="small"
                icon={<VisibilityIcon className={css.visibilityIcon} />}
                label="Read-only"
              />
            )}
          </Typography>

          <Box flex={1} />

          <ChainIndicator chainId={chainId} responsive />
        </Link>
      </Track>

      <ListItemSecondaryAction>
        <Tooltip placement="top" arrow title="Bookmark this account">
          <IconButton
            edge="end"
            size="small"
            sx={{ mx: 1 }}
            onClick={isBookmarked ? removeFromBookmarks : addToBookmarks}
          >
            <SvgIcon
              component={isBookmarked ? BookmarkedIcon : BookmarkIcon}
              inheritViewBox
              color={isBookmarked ? 'primary' : undefined}
              fontSize="medium"
            />
          </IconButton>
        </Tooltip>
        <SafeListContextMenu name={name} address={address} chainId={chainId} />
      </ListItemSecondaryAction>
    </ListItemButton>
  )
}

export default AccountItem

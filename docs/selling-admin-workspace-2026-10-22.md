# Admin Selling Centre workspace

Replaces the expandable sell-request cards with a case inbox and a dedicated detail pane. The admin menu now calls it Selling Centre.

- Overview of loaded new, in-progress, quoted and closed cases; status filters and search across seller name, email, phone, description and reference.
- Seller contact actions, full item description, dates, status guidance, Start review/Reopen actions, and a larger internal-notes editor.
- Explicit Save changes and unsaved indicators. Drafts stay attached to the individual case when switching, searching, filtering or refreshing. Failed/conflicting saves retain drafts. A saved case stays selected when its new status exits the filter.
- Phone/tablet inbox-to-detail navigation with a Back to cases action.
- Responsive storefront navigation now wraps safely and uses narrower padding on intermediate widths; the extra Admin link no longer overflows at 1024px.
- Uses the existing authenticated admin API, optimistic versions and audit trail. No database or backend changes; email actions open the administrator's email application and notes are not customer messages.

Validation: production build; browser fixtures for per-case draft isolation, conflict/refresh/retry, status-filter transitions, phone search, Start review and mobile list/detail navigation. Viewports 1440/1024/768/390/320 have no horizontal overflow or page exceptions. Screenshots inspected. No real customer records or messages changed during testing. Existing CI runs the full regression suite before release.

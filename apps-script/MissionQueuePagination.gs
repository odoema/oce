/* OCE Mission Queue Pagination V1
 * LEGO block: persistent mission queue -> accurate server-side pages.
 * This block does not alter queue creation, discovery, or worker behaviour.
 */

const OCE_QUEUE_PAGE = {
  VERSION: '1.0.0',
  DEFAULT_SIZE: 25,
  MAX_SIZE: 100
};

function getOceMissionQueuePage(missionId, page, pageSize) {
  const id = String(missionId || '').trim();
  if (!id) throw Error('Mission ID is required.');

  const requestedPage = Math.max(1, Number(page || 1));
  const size = Math.max(1, Math.min(OCE_QUEUE_PAGE.MAX_SIZE, Number(pageSize || OCE_QUEUE_PAGE.DEFAULT_SIZE)));
  const queue = getOceSpreadsheet_().getSheetByName(OCE_SOURCE_REGISTRY.QUEUE_SHEET);

  if (!queue || queue.getLastRow() < 2) {
    return {
      version: OCE_QUEUE_PAGE.VERSION,
      mission_id: id,
      page: 1,
      page_size: size,
      total: 0,
      total_pages: 0,
      has_previous: false,
      has_next: false,
      items: []
    };
  }

  const rows = queue.getRange(2, 1, queue.getLastRow() - 1, 11).getValues();
  const filtered = rows.filter(function(r) {
    return String(r[10] || '').indexOf('mission_id=' + id) !== -1;
  }).sort(function(a, b) {
    const priority = Number(b[3] || 0) - Number(a[3] || 0);
    if (priority !== 0) return priority;
    return new Date(a[5] || 0).getTime() - new Date(b[5] || 0).getTime();
  });

  const total = filtered.length;
  const totalPages = total ? Math.ceil(total / size) : 0;
  const safePage = totalPages ? Math.min(requestedPage, totalPages) : 1;
  const start = (safePage - 1) * size;
  const items = filtered.slice(start, start + size).map(function(r) {
    return {
      queue_id: r[0],
      source_id: r[1],
      url: r[2],
      priority: Number(r[3] || 0),
      status: String(r[4] || ''),
      queued_at: r[5],
      started_at: r[6],
      completed_at: r[7],
      attempt_count: Number(r[8] || 0),
      error: String(r[9] || ''),
      source: String(r[10] || '')
    };
  });

  return {
    version: OCE_QUEUE_PAGE.VERSION,
    mission_id: id,
    page: safePage,
    page_size: size,
    total: total,
    total_pages: totalPages,
    has_previous: safePage > 1,
    has_next: safePage < totalPages,
    items: items
  };
}

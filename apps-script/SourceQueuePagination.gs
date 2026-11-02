/* OCE Source Queue Pagination V1.0
 * LEGO block: paginated read-only view over a mission's persistent source queue.
 * Does not change queue state, scraping, ranking, or mission control.
 */

const OCE_QUEUE_PAGINATION = {
  VERSION: '1.0.0',
  DEFAULT_PAGE_SIZE: 25,
  MAX_PAGE_SIZE: 100
};

function getOceMissionQueuePage(missionId, page, pageSize) {
  const id = String(missionId || '').trim();
  if (!id) throw Error('Mission ID is required.');

  let p = Number(page || 1);
  let size = Number(pageSize || OCE_QUEUE_PAGINATION.DEFAULT_PAGE_SIZE);
  p = Math.max(1, Math.floor(isFinite(p) ? p : 1));
  size = Math.max(1, Math.min(OCE_QUEUE_PAGINATION.MAX_PAGE_SIZE, Math.floor(isFinite(size) ? size : OCE_QUEUE_PAGINATION.DEFAULT_PAGE_SIZE)));

  const queue = getOceSpreadsheet_().getSheetByName(OCE_SOURCE_REGISTRY.QUEUE_SHEET);
  if (!queue || queue.getLastRow() < 2) {
    return {page:1,page_size:size,total:0,total_pages:0,items:[]};
  }

  const rows = queue.getRange(2,1,queue.getLastRow()-1,11).getValues();
  const items = rows.filter(function(r) {
    return String(r[10] || '').indexOf('mission_id='+id) !== -1;
  }).map(function(r) {
    return {
      queue_id:r[0],
      source_id:r[1],
      url:r[2],
      priority:Number(r[3] || 0),
      status:String(r[4] || ''),
      queued_at:r[5],
      started_at:r[6],
      completed_at:r[7],
      attempt_count:Number(r[8] || 0),
      error:String(r[9] || ''),
      source:String(r[10] || '')
    };
  }).sort(function(a,b) {
    return Number(b.priority || 0) - Number(a.priority || 0);
  });

  const total = items.length;
  const totalPages = total ? Math.ceil(total / size) : 0;
  const safePage = totalPages ? Math.min(p,totalPages) : 1;
  const start = (safePage - 1) * size;

  return {
    page:safePage,
    page_size:size,
    total:total,
    total_pages:totalPages,
    items:items.slice(start,start + size)
  };
}

function testSourceQueuePagination() {
  return {ok:true,version:OCE_QUEUE_PAGINATION.VERSION};
}

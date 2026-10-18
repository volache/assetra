import { money, formatNumber } from "../../lib/formatters";
import { FilterCombo } from "../inventory/QueryControls";

function GeoListViewContent({
  activeFilterCount,
  appliedTerm,
  clearFilters,
  compactFilters,
  compactFiltersOpen,
  currentPage,
  filters,
  filtered,
  geoFilterSentinelRef,
  onCompactFiltersOpenChange,
  onCreateLand,
  onEditLand,
  onOpenMap,
  onOpenOwnership,
  onDeleteOwnership,
  onReplaceOwnership,
  onUploadOwnership,
  onOwnershipUploadChange,
  onPageChange,
  onPageSizeChange,
  onSearch,
  onTermChange,
  onViewMap,
  pageRows,
  pageSize,
  ownershipDocumentsByLandId,
  ownershipUploadInputRef,
  isUploadingOwnershipDocuments,
  term,
  totalArea,
  totalPages,
  totalValue,
  viewTransition,
}) {
  return (
    <section
      className={`page geographic-page is-list-view ${viewTransition ? "geo-view-transition" : ""}`}
    >
      <div className="page-heading">
        <div>
          <p className="eyebrow">GEOSPATIAL ASSET DIRECTORY</p>
          <h1>地理圖資</h1>
          <p>
            以 Mapbox
            底圖與地籍範圍檢視花蓮航空站土地財產，並與財產編號、面積及帳面價值交叉核對。
          </p>
        </div>
        <div className="geo-page-actions">
          <button className="button button-secondary" onClick={onCreateLand} type="button">新增土地</button>
          <button className="button button-primary" onClick={onViewMap} type="button">地圖檢視</button>
        </div>
      </div>
      <div
        aria-hidden="true"
        className="filter-sentinel"
        ref={geoFilterSentinelRef}
      />
      {compactFilters && (
        <div className="compact-filter-bar compact-filter-bar-fixed">
          <button
            aria-expanded={compactFiltersOpen}
            className="compact-filter-trigger"
            onClick={() => onCompactFiltersOpenChange((open) => !open)}
            type="button"
          >
            篩選條件{activeFilterCount ? <b>{activeFilterCount}</b> : null}
          </button>
          <label className="compact-search">
            <span className="sr-only">全局關鍵字搜尋</span>
            <input
              onChange={(event) => onTermChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") onSearch();
              }}
              placeholder="輸入後按 Enter 搜尋…"
              value={term}
            />
          </label>
          <button
            className="compact-clear"
            disabled={!activeFilterCount}
            onClick={clearFilters}
            type="button"
          >
            清除
          </button>
          {compactFiltersOpen && (
            <div className="compact-filter-popover">{filters("compact-")}</div>
          )}
        </div>
      )}
      <section aria-label="篩選條件" className="search-panel geo-filter-panel">
        <div className="filter-panel-heading">
          <div>
            <h2>篩選條件</h2>
            <p>可直接輸入文字，或由土地資料中的選項挑選。</p>
          </div>
          <button
            className="button button-secondary filter-reset"
            onClick={clearFilters}
            type="button"
          >
            清除篩選
          </button>
        </div>
        {filters("geo-")}
        <div className="advanced-search">
          <label className="search-field">
            全局關鍵字搜尋
            <input
              onChange={(event) => onTermChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") onSearch();
              }}
              placeholder="輸入地段、地號、財產名稱或編號"
              value={term}
            />
          </label>
          <div className="advanced-search-actions">
            <button
              className={`button button-primary search-submit ${term !== appliedTerm ? "pending" : ""}`}
              onClick={onSearch}
              type="button"
            >
              搜尋
            </button>
          </div>
        </div>
      </section>
      <section className="geo-table-panel">
        <div className="result-summary geo-result-summary">
          <p className="result-count">
            查詢結果：<strong>{formatNumber(filtered.length)}</strong> 筆
          </p>
          <p>土地總面積：{formatNumber(totalArea)} m²</p>
          <p>帳面價值：NT$ {money(totalValue)}</p>
          <label className="page-size">
            每頁顯示
            <select
              aria-label="每頁顯示土地筆數"
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
              value={pageSize}
            >
              <option value="25">25 筆</option>
              <option value="50">50 筆</option>
              <option value="100">100 筆</option>
            </select>
          </label>
          <p>
            第 {currentPage}／{totalPages} 頁
          </p>
        </div>
        <div className="geo-table-wrap">
          <table>
            <thead>
              <tr>
                <th>段小段</th>
                <th>地號</th>
                <th>面積 (M²)</th>
                <th>使用資訊</th>
                <th>公告土地現值</th>
                <th>公告地價</th>
                <th>財產編號</th>
                <th>財產名稱</th>
                <th>財產價值 (元)</th>
                <th>關聯建號</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((land) => {
                const [number, serial] = String(land.assetNumber).split("\n");
                return (
                  <tr key={land.id}>
                    <td>
                      {land.section}
                      <small>{land.sectionCode}</small>
                    </td>
                    <td>{land.landNumber}</td>
                    <td className="money">{formatNumber(land.area)}</td>
                    <td>
                      <strong>{land.zoningLabel}</strong>
                      <small>{land.landUseType}</small>
                    </td>
                    <td className="money">
                      {formatNumber(land.announcedLandValue)}
                    </td>
                    <td className="money">
                      {formatNumber(land.announcedLandPrice)}
                    </td>
                    <td className="mono">
                      <strong>{number}</strong>
                      {serial && <small>{serial}</small>}
                    </td>
                    <td>
                      <strong>{land.name}</strong>
                      <small>
                        {land.section}
                        {land.landNumber}
                      </small>
                    </td>
                    <td className="money">{money(land.price)}</td>
                    <td>{land.relatedBuildingNumbers}</td>
                    <td>
                      <button
                        className="row-action"
                        onClick={() => onOpenMap(land)}
                        type="button"
                      >
                        查看地圖
                      </button>
                      <button className="row-action" onClick={() => onEditLand(land)} type="button">編輯土地</button>
                      {ownershipDocumentsByLandId[land.documentLandParcelId]?.[0] ? (
                        <>
                          <button className="row-action" onClick={() => onOpenOwnership(ownershipDocumentsByLandId[land.documentLandParcelId][0])} type="button">查看權狀</button>
                          <button className="row-action" disabled={isUploadingOwnershipDocuments} onClick={() => onReplaceOwnership(land, ownershipDocumentsByLandId[land.documentLandParcelId][0])} type="button">更新權狀</button>
                          <button className="row-action" onClick={() => onDeleteOwnership(ownershipDocumentsByLandId[land.documentLandParcelId][0])} type="button">刪除權狀</button>
                        </>
                      ) : (
                        <button className="row-action" disabled={isUploadingOwnershipDocuments} onClick={() => onUploadOwnership(land)} type="button">上傳權狀</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <input accept="application/pdf,.pdf" className="sr-only" onChange={onOwnershipUploadChange} ref={ownershipUploadInputRef} type="file" />
        {totalPages > 1 && (
          <nav aria-label="土地列表分頁" className="pagination">
            <button
              className="button button-secondary"
              disabled={currentPage === 1}
              onClick={() => onPageChange(currentPage - 1)}
              type="button"
            >
              上一頁
            </button>
            <span>
              第 {currentPage}／{totalPages} 頁
            </span>
            <button
              className="button button-secondary"
              disabled={currentPage === totalPages}
              onClick={() => onPageChange(currentPage + 1)}
              type="button"
            >
              下一頁
            </button>
          </nav>
        )}
      </section>
    </section>
  );
}

export function GeoListView({
  activeFilterCount,
  appliedTerm,
  clearFilters,
  compactFilters,
  compactFiltersOpen,
  currentPage,
  filtered,
  geoFilterSentinelRef,
  landFilters,
  landUseTypes,
  onCompactFiltersOpenChange,
  onCreateLand,
  onEditLand,
  onFilterChange,
  onOpenFilterChange,
  onOpenMap,
  onOpenOwnership,
  onDeleteOwnership,
  onReplaceOwnership,
  onUploadOwnership,
  onOwnershipUploadChange,
  onPageChange,
  onPageSizeChange,
  onSearch,
  onTermChange,
  onViewMap,
  openFilterId,
  pageRows,
  pageSize,
  ownershipDocumentsByLandId,
  ownershipUploadInputRef,
  isUploadingOwnershipDocuments,
  sections,
  term,
  totalArea,
  totalPages,
  totalValue,
  viewTransition,
  zonings,
}) {
  const filterFields = [
    ["section", "地段", sections],
    ["zoning", "使用分區", zonings],
    ["landUseType", "使用地類別", landUseTypes],
  ];
  const filters = (prefix = "") => (
    <div className="filter-grid">
      {filterFields.map(([key, label, options]) => (
        <FilterCombo
          id={`${prefix}${key}`}
          key={key}
          label={label}
          onChange={(value) => onFilterChange(key, value)}
          onOpenChange={onOpenFilterChange}
          open={openFilterId === `${prefix}${key}`}
          options={options}
          value={landFilters[key]}
        />
      ))}
    </div>
  );
  return (
    <GeoListViewContent
      activeFilterCount={activeFilterCount}
      appliedTerm={appliedTerm}
      clearFilters={clearFilters}
      compactFilters={compactFilters}
      compactFiltersOpen={compactFiltersOpen}
      currentPage={currentPage}
      filters={filters}
      filtered={filtered}
      geoFilterSentinelRef={geoFilterSentinelRef}
      onCompactFiltersOpenChange={onCompactFiltersOpenChange}
      onCreateLand={onCreateLand}
      onEditLand={onEditLand}
      onOpenMap={onOpenMap}
      onOpenOwnership={onOpenOwnership}
      onDeleteOwnership={onDeleteOwnership}
      onReplaceOwnership={onReplaceOwnership}
      onUploadOwnership={onUploadOwnership}
      onOwnershipUploadChange={onOwnershipUploadChange}
      onPageChange={onPageChange}
      onPageSizeChange={onPageSizeChange}
      onSearch={onSearch}
      onTermChange={onTermChange}
      onViewMap={onViewMap}
      pageRows={pageRows}
      pageSize={pageSize}
      ownershipDocumentsByLandId={ownershipDocumentsByLandId}
      ownershipUploadInputRef={ownershipUploadInputRef}
      isUploadingOwnershipDocuments={isUploadingOwnershipDocuments}
      term={term}
      totalArea={totalArea}
      totalPages={totalPages}
      totalValue={totalValue}
      viewTransition={viewTransition}
    />
  );
}

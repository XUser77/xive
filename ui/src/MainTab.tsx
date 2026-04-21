import { useState } from "react";

import { Positions } from "./Positions";
import { CollateralList } from "./CollateralList";

export function MainTab() {
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = () => setRefreshKey((k) => k + 1);

  return (
    <>
      <Positions refreshKey={refreshKey} />
      <CollateralList onPositionOpened={bump} />
    </>
  );
}

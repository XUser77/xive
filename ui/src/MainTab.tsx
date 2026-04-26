import { useState } from "react";

import { Positions } from "./Positions";
import { CollateralList } from "./CollateralList";

export function MainTab({ onBalanceChange }: { onBalanceChange: () => void }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = () => {
    setRefreshKey((k) => k + 1);
    onBalanceChange();
  };

  return (
    <>
      <Positions refreshKey={refreshKey} />
      <CollateralList onPositionOpened={bump} />
    </>
  );
}
